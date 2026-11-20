import json
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
    m.init_db()
    return TestClient(m.app)


def seed(client):
    with m.db() as c:
        c.execute("INSERT INTO videos(id,name,path,duration,status) VALUES ('test','test.mp4','not-used.mp4',16,'ready')")
        c.execute("INSERT INTO segments(video_id,position,start_ms,end_ms,hanzi,units) VALUES ('test',0,0,4000,'你好',?)", (json.dumps(m.ruby_units('你好')),))
    return m.segments_for('test')[0]['id']


def test_edit_persistence_restart_retry_and_range(client, monkeypatch):
    ident = seed(client)
    result = client.patch(f'/api/videos/test/segments/{ident}', json={'hanzi': '重庆银行', 'translation_id': 'Bank di Chongqing'})
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
    assert m.segments_for('test')[0]['translation_id'] == 'Bank di Chongqing'
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
        client.patch(f'/api/videos/test/segments/{ident}', json={'hanzi':'再见','translation_id':'Sampai jumpa'})
        return SimpleNamespace(raise_for_status=lambda: None, json=lambda: {'message': {'content': json.dumps({'translations':[{'id':ident,'text':'Halo'}]})}})
    fake=Mock()
    fake.__enter__=Mock(return_value=SimpleNamespace(post=post))
    fake.__exit__=Mock(return_value=False)
    monkeypatch.setattr(m.httpx,'Client',lambda **kw:fake)
    m.translate('test')
    assert m.segments_for('test')[0]['translation_id'] == 'Sampai jumpa'


def test_hanzi_edit_marks_translation_stale(client):
    ident = seed(client)
    client.patch(f'/api/videos/test/segments/{ident}',json={'hanzi':'你好','translation_id':'Halo'})
    client.patch(f'/api/videos/test/segments/{ident}',json={'hanzi':'你好啊','translation_id':'Halo'})
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
        data={'translations':[{'id':s['id'],'text':'Halo'} for s in reversed(batch)]}
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
    # Real upload validation + extraction; deterministic ASR avoids downloading a model.
    monkeypatch.setattr(m, 'whisper_model', SimpleNamespace(transcribe=lambda *a, **kw: ([SimpleNamespace(text='你好', start=0, end=4)], None)))
    monkeypatch.setattr(m, 'translate', lambda ident: m.status(ident, 'ready'))
    response=client.post('/api/videos',files={'file':('dialog.mp4',fixture.read_bytes(),'video/mp4')})
    assert response.status_code == 201
    ident = response.json()['id']
    m.process(ident, False)
    v=client.get(f'/api/videos/{ident}').json()
    assert v['status'] == 'ready' and v['segments'][0]['hanzi'] == '你好'
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
