import {describe,it,expect} from 'vitest';
import {activeSegment} from './sync';
import {demoSegments, demoVideo} from './demo';
import {translationLanguageName} from './language';
describe('video/transcript boundaries',()=>{
  it('selects the next row exactly at a shared boundary',()=>{
    expect(activeSegment(demoSegments,3999)).toBe(1);
    expect(activeSegment(demoSegments,4000)).toBe(2);
    expect(activeSegment(demoSegments,16000)).toBeNull();
  });
  it('does not highlight during gaps or before the start',()=>{
    expect(activeSegment(demoSegments,-1)).toBeNull();
    expect(activeSegment([{...demoSegments[0],start_ms:200}],100)).toBeNull();
  });
  it('has one pinyin unit per demo character',()=>{
    for(const s of demoSegments) expect(s.units.map(u=>u.hanzi).join('')).toBe(s.hanzi);
  });
  it('labels new demo content as English and legacy content as Indonesian',()=>{
    expect(demoVideo.translation_language).toBe('en');
    expect(demoSegments[0].translation_id).toBe('Hi! What would you like to do today?');
    expect(translationLanguageName('en')).toBe('English');
    expect(translationLanguageName('id')).toBe('Indonesian');
  });
});
