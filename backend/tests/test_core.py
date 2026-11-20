import pytest
from app.core import validate_translations, export_segments, ruby_units, translation_prompt


def test_ids_are_mapped_not_zipped():
    assert validate_translations({'translations': [{'id': 2, 'text': 'dua'}, {'id': 1, 'text': 'satu'}]}, [1, 2]) == {1: 'satu', 2: 'dua'}


@pytest.mark.parametrize('items', [
    [{'id': 1, 'text': 'a'}, {'id': 1, 'text': 'b'}],
    [{'id': 3, 'text': 'a'}], [{'id': 1, 'text': ''}],
    [{'id': True, 'text': 'a'}], [{'id': '1', 'text': 'a'}], []])
def test_invalid_translation_ids(items):
    with pytest.raises(ValueError):
        validate_translations({'translations': items}, [1, 2])


def test_srt_millisecond_precision_and_safe_newlines():
    row = {'start_ms': 3599123, 'end_ms': 3600456, 'hanzi': '你好', 'translation_id': 'Halo\nsemua', 'units': ruby_units('你好')}
    assert export_segments([row], 'srt-hanzi') == '1\n00:59:59,123 --> 01:00:00,456\n你好\n'
    assert export_segments([row], 'srt-id').endswith('Halo semua\n')
    assert 'nǐ hǎo' in export_segments([row], 'txt')
    assert export_segments([dict(row, translation_id='')], 'srt-id') == '\n'


def test_phrase_context_and_punctuation():
    units = ruby_units('重庆银行。')
    assert len(units) == 5
    assert units[0]['pinyin'] == 'chóng'
    assert units[3]['pinyin'] == 'háng'
    assert units[-1] == {'hanzi': '。', 'pinyin': ''}


def test_translation_targets_and_export_labels():
    assert 'natural English' in translation_prompt('en')
    assert 'natural Indonesian' in translation_prompt('id')
    row = {'start_ms':0, 'end_ms':1000, 'hanzi':'你好', 'units':ruby_units('你好'), 'translation_id':'Hello'}
    assert export_segments([row], 'txt').startswith('Translation language: English (en)')
    assert export_segments([dict(row, translation_id='Halo')], 'txt', 'id').startswith('Translation language: Indonesian (id)')
