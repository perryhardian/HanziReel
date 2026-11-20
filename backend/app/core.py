import json
from pypinyin import pinyin, Style


def ruby_units(text):
    # Convert the entire phrase first, so polyphonic characters retain context.
    readings = pinyin(text, style=Style.TONE, heteronym=False, errors=lambda s: list(s))
    return [{"hanzi": char, "pinyin": reading[0] if reading[0] != char else ""}
            for char, reading in zip(text, readings)]


def validate_translations(value, expected_ids):
    if not isinstance(value, dict) or not isinstance(value.get("translations"), list):
        raise ValueError("Respons terjemahan bukan objek translations.")
    result = {}
    for item in value["translations"]:
        if not isinstance(item, dict):
            raise ValueError("Format terjemahan tidak valid.")
        ident, content = item.get("id"), item.get("text")
        if type(ident) is not int or ident in result or not isinstance(content, str) or not content.strip():
            raise ValueError("ID duplikat atau teks terjemahan kosong.")
        result[ident] = content.strip()
    if set(result) != set(expected_ids):
        raise ValueError("ID terjemahan tidak cocok dengan segmen yang dikirim.")
    return result


def timestamp(ms):
    seconds, milli = divmod(ms, 1000)
    minutes, sec = divmod(seconds, 60)
    hours, minute = divmod(minutes, 60)
    return f"{hours:02}:{minute:02}:{sec:02},{milli:03}"


def export_segments(segments, kind):
    if kind == "txt":
        return "\n\n".join(f"[{timestamp(s['start_ms'])} → {timestamp(s['end_ms'])}]\n{s['hanzi']}\n"
                           + " ".join(u['pinyin'] or u['hanzi'] for u in s['units'])
                           + f"\n{s['translation_id']}" for s in segments) + "\n"
    field = "hanzi" if kind == "srt-hanzi" else "translation_id"
    # Empty SRT cues are ambiguous for subtitle readers; retain only available text.
    segments = [s for s in segments if s[field].strip()]
    return "\n\n".join(f"{i}\n{timestamp(s['start_ms'])} --> {timestamp(s['end_ms'])}\n"
                       + s[field].replace("\r", " ").replace("\n", " ")
                       for i, s in enumerate(segments, 1)) + "\n"
