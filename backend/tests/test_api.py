import json
import queue
import sqlite3
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import httpx
import pytest
from fastapi.testclient import TestClient
from app import main as m


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(m, 'DATA', tmp_path)
    monkeypatch.setattr(m, 'tasks', queue.Queue())
    m.init_db()
    return TestClient(m.app)


def seed(client):
    with m.db() as c:
        c.execute("INSERT INTO videos(id,name,path,duration,status) VALUES ('test','test.mp4','not-used.mp4',16,'ready')")
        c.execute("INSERT INTO segments(video_id,position,start_ms,end_ms,hanzi,units) VALUES ('test',0,0,4000,'你好',?)", (json.dumps(m.ruby_units('你好')),))
    return m.segments_for('test')[0]['id']


def test_edit_persistence_restart_retry_and_range(client, monkeypatch):
    ident = seed(client)
    result = client.patch(f'/api/videos/test/segments/{ident}', json={'hanzi': '重庆银行', 'translation_id': 'Bank in Chongqing'})
    assert result.status_code == 200
    # A restart must preserve corrections and flag in-flight work.
    m.status('test', 'translating')
    m.init_db()
    v = client.get('/api/videos/test').json()
    assert v['status'] == 'interrupted'
    row = v['segments'][0]
    assert row['start_ms'] == 0 and row['end_ms'] == 4000
    assert row['units'][0]['pinyin'] == 'chóng'
    assert row['translation_state'] == 'edited'
    assert client.post('/api/videos/test/retry?translation_only=true').status_code == 200
    assert client.post('/api/videos/test/retry').status_code == 409
    m.translate('test')  # user translation is skipped, even without Ollama
    assert m.segments_for('test')[0]['translation_id'] == 'Bank in Chongqing'
    assert '重庆银行' in client.get('/api/videos/test/export?kind=srt-hanzi').text
    fixture = Path(__file__).resolve().parents[2] / 'frontend/public/demo.mp4'
    if fixture.exists():
        with m.db() as c:
            c.execute('UPDATE videos SET path=? WHERE id=?', (str(fixture), 'test'))
        response = client.get('/api/videos/test/media', headers={'Range': 'bytes=0-99'})
        assert response.status_code == 206
        assert len(response.content) == 100


def test_ollama_unavailable_keeps_transcript_and_marks_failure(client, monkeypatch):
    seed(client)
    fake = Mock()
    fake.__enter__ = Mock(side_effect=httpx.ConnectError('Ollama unavailable'))
    fake.__exit__ = Mock(return_value=False)
    monkeypatch.setattr(m.httpx, 'Client', lambda **kw: fake)
    m.translate('test')
    v = client.get('/api/videos/test').json()
    assert v['status'] == 'translation_error'
    assert v['segments'][0]['hanzi'] == '你好'
    assert v['segments'][0]['translation_state'] == 'failed'
    assert 'ollama pull' in v['error']


def test_edit_during_translation_wins(client, monkeypatch):
    ident = seed(client)
    def post(*args, **kwargs):
        client.patch(f'/api/videos/test/segments/{ident}', json={'hanzi':'再见','translation_id':'Goodbye'})
        return SimpleNamespace(raise_for_status=lambda: None, json=lambda: {'message': {'content': json.dumps({'translations':[{'id':ident,'text':'Hello'}]})}})
    fake=Mock()
    fake.__enter__=Mock(return_value=SimpleNamespace(post=post))
    fake.__exit__=Mock(return_value=False)
    monkeypatch.setattr(m.httpx,'Client',lambda **kw:fake)
    m.translate('test')
    assert m.segments_for('test')[0]['translation_id'] == 'Goodbye'


def test_hanzi_edit_marks_translation_stale(client):
    ident = seed(client)
    client.patch(f'/api/videos/test/segments/{ident}',json={'hanzi':'你好','translation_id':'Hello'})
    client.patch(f'/api/videos/test/segments/{ident}',json={'hanzi':'你好啊','translation_id':'Hello'})
    assert m.segments_for('test')[0]['translation_state'] == 'stale'


def test_failed_batch_retains_success_and_retry_only_missing(client, monkeypatch):
    seed(client)
    with m.db() as c:
        for position in range(1, 9):
            c.execute("INSERT INTO segments(video_id,position,start_ms,end_ms,hanzi,units) VALUES ('test',?,0,1000,'你好','[]')", (position,))
    calls=[]
    def post(*args, **kwargs):
        batch=json.loads(kwargs['json']['messages'][-1]['content'])
        calls.append([s['id'] for s in batch])
        if len(batch)==1:
            raise httpx.ConnectError('failed last batch')
        data={'translations':[{'id':s['id'],'text':'Hello'} for s in reversed(batch)]}
        return SimpleNamespace(raise_for_status=lambda:None,json=lambda:{'message':{'content':json.dumps(data)}})
    fake=Mock()
    fake.__enter__=Mock(return_value=SimpleNamespace(post=post))
    fake.__exit__=Mock(return_value=False)
    monkeypatch.setattr(m.httpx,'Client',lambda **kw:fake)
    m.translate('test')
    rows=m.segments_for('test')
    assert all(s['translation_state']=='ready' for s in rows[:8])
    assert rows[-1]['translation_state']=='failed'
    calls.clear()
    m.translate('test')
    assert calls==[[rows[-1]['id']]]


def test_upload_and_processing_real_media_with_fake_asr(client, monkeypatch):
    root = Path(__file__).resolve().parents[2]
    ffmpeg = root / 'frontend/node_modules/ffmpeg-static/ffmpeg.exe'
    ffprobe = root / 'frontend/node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe'
    fixture = root / 'frontend/public/demo.mp4'
    if not all(p.exists() for p in (ffmpeg, ffprobe, fixture)):
        pytest.skip('Run npm install and generate-demo.mjs first')
    monkeypatch.setattr(m, 'FFMPEG', str(ffmpeg))
    monkeypatch.setattr(m, 'FFPROBE', str(ffprobe))
    # Real validation/extraction + mocked ASR/Ollama: verify upload through export.
    monkeypatch.setattr(m, 'whisper_model', SimpleNamespace(transcribe=lambda *a, **kw: ([SimpleNamespace(text='你好', start=0, end=4), SimpleNamespace(text='再见', start=4, end=8)], None)))
    requests = []
    def post(*args, **kwargs):
        payload = kwargs['json']
        requests.append(payload)
        batch = json.loads(payload['messages'][-1]['content'])
        texts = {'你好': 'Hello', '再见': 'Goodbye'}
        content = json.dumps({'translations': [{'id': s['id'], 'text': texts[s['text']]} for s in reversed(batch)]})
        return SimpleNamespace(raise_for_status=lambda: None, json=lambda: {'message': {'content': content}})
    fake = Mock()
    fake.__enter__ = Mock(return_value=SimpleNamespace(post=post))
    fake.__exit__ = Mock(return_value=False)
    monkeypatch.setattr(m.httpx, 'Client', lambda **kw: fake)
    response=client.post('/api/videos',files={'file':('dialog.mp4',fixture.read_bytes(),'video/mp4')})
    assert response.status_code == 201
    ident = response.json()['id']
    assert client.get(f'/api/videos/{ident}').json()['translation_language'] == 'en'
    m.process(ident, False)
    v=client.get(f'/api/videos/{ident}').json()
    assert v['status'] == 'ready' and v['segments'][0]['hanzi'] == '你好'
    assert 'natural English' in requests[0]['messages'][0]['content']
    assert [(s['start_ms'], s['end_ms'], s['translation_id']) for s in v['segments']] == [(0, 4000, 'Hello'), (4000, 8000, 'Goodbye')]
    exported = client.get(f'/api/videos/{ident}/export?kind=srt-translation')
    assert exported.text == '1\n00:00:00,000 --> 00:00:04,000\nHello\n\n2\n00:00:04,000 --> 00:00:08,000\nGoodbye\n'
    assert exported.headers['content-language'] == 'en'
    assert 'hanzireel.en.srt' in exported.headers['content-disposition']
    assert client.get(f'/api/videos/{ident}/export?kind=txt').text.startswith('Translation language: English (en)')
    assert client.get(f'/api/videos/{ident}/export?kind=srt-id').status_code == 400
    assert not list(m.DATA.glob('*.wav'))
    assert client.post('/api/videos',files={'file':('bad.mp4',b'not video','video/mp4')}).status_code == 400


def test_invalid_file_and_duration(client, monkeypatch):
    assert client.post('/api/videos', files={'file':('bad.txt',b'bad')}).status_code == 400
    monkeypatch.setattr(m, 'MAX_BYTES', 2)
    assert client.post('/api/videos', files={'file':('big.mp4',b'123')}).status_code == 400
    assert not list(m.DATA.glob('*.mp4'))
    monkeypatch.setattr(m, 'command', lambda *a: json.dumps({'format':{'duration':'2','format_name':'mov,mp4'},'streams':[{'codec_type':'video'}]}))
    with pytest.raises(ValueError, match='audio'):
        m.probe('unused')


def test_legacy_migration_preserves_text_edits_and_retry_language(tmp_path, monkeypatch):
    monkeypatch.setattr(m, 'DATA', tmp_path)
    monkeypatch.setattr(m, 'tasks', queue.Queue())
    # Exact pre-language schema, including an edited row and a failed batch row.
    with sqlite3.connect(tmp_path / 'hanzireel.sqlite3') as c:
        c.executescript("""
        CREATE TABLE videos(id TEXT PRIMARY KEY,name TEXT NOT NULL,path TEXT NOT NULL,
          duration REAL NOT NULL,status TEXT NOT NULL,error TEXT NOT NULL DEFAULT '',
          demo INTEGER NOT NULL DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE segments(id INTEGER PRIMARY KEY AUTOINCREMENT,video_id TEXT REFERENCES videos(id),
          position INTEGER NOT NULL,start_ms INTEGER NOT NULL,end_ms INTEGER NOT NULL,
          hanzi TEXT NOT NULL,units TEXT NOT NULL,translation_id TEXT NOT NULL DEFAULT '',
          translation_state TEXT NOT NULL DEFAULT 'pending',revision INTEGER NOT NULL DEFAULT 0);
        INSERT INTO videos(id,name,path,duration,status,error) VALUES ('old','old.mp4','old.mp4',16,'translation_error','Terjemahan belum lengkap.');
        INSERT INTO videos(id,name,path,duration,status,error) VALUES ('interrupted','interrupted.mp4','unused',16,'interrupted','Pemrosesan terputus.');
        INSERT INTO videos(id,name,path,duration,status,error) VALUES ('broken','broken.mp4','unused',16,'error','Pemrosesan gagal.');
        """)
        c.executemany("INSERT INTO segments(video_id,position,start_ms,end_ms,hanzi,units,translation_id,translation_state,revision) VALUES ('old',?,?,?,?,?,?,?,?)", [
            (0, 0, 4000, '你好', json.dumps(m.ruby_units('你好')), 'Halo, koreksi saya', 'edited', 3),
            (1, 4000, 8000, '谢谢', json.dumps(m.ruby_units('谢谢')), 'Terima kasih', 'ready', 0),
            (2, 8000, 12000, '再见', json.dumps(m.ruby_units('再见')), '', 'failed', 0)])
    with m.db() as c:
        before = [dict(r) for r in c.execute('SELECT * FROM segments ORDER BY id')]
    m.init_db()
    m.init_db()  # Idempotent: legacy records must not become English on restart.
    client = TestClient(m.app)
    video = client.get('/api/videos/old').json()
    assert video['translation_language'] == 'id'
    assert 'Translation is incomplete' in video['error']
    assert m.get_video('interrupted')['error'].startswith('Processing was interrupted')
    assert m.get_video('broken')['error'].startswith('Processing failed.')
    assert client.get('/api/videos').json()[0]['translation_language'] == 'id'
    with m.db() as c:
        assert [dict(r) for r in c.execute('SELECT * FROM segments ORDER BY id')] == before
        c.execute("INSERT INTO videos(id,name,path,duration,status) VALUES ('new','new.mp4','new.mp4',16,'ready')")
    m.init_db()
    assert m.get_video('new')['translation_language'] == 'en'
    requests = []
    def post(*args, **kwargs):
        payload = kwargs['json']
        requests.append(payload)
        batch = json.loads(payload['messages'][-1]['content'])
        assert [s['id'] for s in batch] == [before[-1]['id']]
        content = json.dumps({'translations': [{'id': batch[0]['id'], 'text': 'Sampai jumpa'}]})
        return SimpleNamespace(raise_for_status=lambda: None, json=lambda: {'message': {'content': content}})
    fake = Mock()
    fake.__enter__ = Mock(return_value=SimpleNamespace(post=post))
    fake.__exit__ = Mock(return_value=False)
    monkeypatch.setattr(m.httpx, 'Client', lambda **kw: fake)
    assert client.post('/api/videos/old/retry?translation_only=true').status_code == 200
    m.process(*m.tasks.get_nowait())
    assert 'natural Indonesian' in requests[0]['messages'][0]['content']
    rows = m.segments_for('old')
    assert [s['translation_id'] for s in rows] == ['Halo, koreksi saya', 'Terima kasih', 'Sampai jumpa']
    assert rows[0]['revision'] == 3 and rows[0]['translation_state'] == 'edited'
    assert [(s['start_ms'], s['end_ms'], s['hanzi'], s['units']) for s in rows] == [(s['start_ms'], s['end_ms'], s['hanzi'], json.loads(s['units'])) for s in before]
    txt = client.get('/api/videos/old/export?kind=txt')
    assert txt.text.startswith('Translation language: Indonesian (id)')
    assert 'Halo, koreksi saya' in txt.text
    srt = client.get('/api/videos/old/export?kind=srt-id')
    assert 'hanzireel.id.srt' in srt.headers['content-disposition']
    assert srt.headers['content-language'] == 'id'
    assert 'Sampai jumpa' in srt.text
    assert client.get('/api/videos/old/export?kind=srt-en').status_code == 400


def test_new_job_retry_keeps_english_and_manual_edits(client, monkeypatch):
    ident = seed(client)
    client.patch(f'/api/videos/test/segments/{ident}', json={'hanzi':'你好', 'translation_id':'My greeting'})
    with m.db() as c:
        c.execute("INSERT INTO segments(video_id,position,start_ms,end_ms,hanzi,units,translation_state) VALUES ('test',1,4000,8000,'再见',?,'failed')", (json.dumps(m.ruby_units('再见')),))
    requests = []
    def post(*args, **kwargs):
        payload = kwargs['json']
        requests.append(payload)
        batch = json.loads(payload['messages'][-1]['content'])
        assert len(batch) == 1 and batch[0]['text'] == '再见'
        content = json.dumps({'translations': [{'id': batch[0]['id'], 'text': 'Goodbye'}]})
        return SimpleNamespace(raise_for_status=lambda: None, json=lambda: {'message': {'content': content}})
    fake = Mock()
    fake.__enter__ = Mock(return_value=SimpleNamespace(post=post))
    fake.__exit__ = Mock(return_value=False)
    monkeypatch.setattr(m.httpx, 'Client', lambda **kw: fake)
    m.status('test', 'translation_error')
    assert client.post('/api/videos/test/retry?translation_only=true').status_code == 200
    m.process(*m.tasks.get_nowait())
    video = client.get('/api/videos/test').json()
    assert video['translation_language'] == 'en'
    assert video['status'] == 'ready'
    assert video['segments'][0]['translation_id'] == 'My greeting'
    assert video['segments'][1]['translation_id'] == 'Goodbye'
    assert 'natural English' in requests[0]['messages'][0]['content']
