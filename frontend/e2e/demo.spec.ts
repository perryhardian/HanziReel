import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {demoVideo} from '../src/demo';

test('demo seeks, follows boundaries, replays one segment, and exports',async({page})=>{
  const errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Conversation: today’s plans'})).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang','en');
  await expect(page.getByText('English translation',{exact:true})).toBeVisible();
  await page.locator('video').evaluate(async (v:HTMLVideoElement)=>{v.muted=true;await new Promise<void>(resolve=>{if(v.readyState>=1)resolve();else v.addEventListener('loadedmetadata',()=>resolve(),{once:true});});});
  await page.getByRole('button',{name:/Play from 00:04/}).click();
  await expect(page.locator('[data-segment="2"]')).toHaveAttribute('aria-current','true');
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeGreaterThan(4.2);
  await page.locator('video').evaluate((v:HTMLVideoElement)=>{v.pause();v.currentTime=8;});
  await expect(page.locator('[data-segment="3"]')).toHaveAttribute('aria-current','true');
  await page.getByRole('button',{name:'Replay segment 00:00'}).click();
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.paused),{timeout:7000}).toBe(true);
  const end=await page.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime);
  expect(end).toBeCloseTo(4,1);
  await page.getByLabel('Follow dialogue').uncheck();
  await expect(page.getByLabel('Follow dialogue')).not.toBeChecked();
  const download=page.waitForEvent('download');
  await page.getByLabel('Export').selectOption('srt-hanzi');
  expect((await download).suggestedFilename()).toBe('hanzireel-demo.zh.srt');
  for(const [kind,extension] of [['srt-translation','srt'],['txt','txt']]) {
    const downloaded=page.waitForEvent('download');
    await page.getByLabel('Export').selectOption(kind);
    const file=await downloaded;
    expect(file.suggestedFilename()).toBe(`hanzireel-demo.en.${extension}`);
    const text=await readFile((await file.path())!,'utf8');
    expect(text).toContain('Hi! What would you like to do today?');
    expect(text).not.toContain('Halo');
    if(kind==='txt') expect(text).toContain('Translation language: English (en)');
  }
  await page.screenshot({path:'../artifacts/desktop.png',fullPage:true});
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('narrow viewport has no horizontal overflow',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await expect(page.getByRole('heading',{name:/Transcript/})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'../artifacts/mobile.png',fullPage:true});
});

for(const [language,name,text] of [['en','English','Hello'],['id','Indonesian','Halo, koreksi saya']]) {
  test(`${name} saved video keeps its language in the editor, retry, and export`,async({page})=>{
    const video={...demoVideo,id:'saved',name:'saved.mp4',demo:0,translation_language:language,segments:[{...demoVideo.segments[0],translation_id:text,translation_state:'edited'}]};
    let retries=0;
    await page.route('**/api/**',async route=>{
      const request=route.request();const url=new URL(request.url());
      if(url.pathname==='/api/videos') return route.fulfill({json:[video]});
      if(url.pathname==='/api/config') return route.fulfill({json:{max_upload_mb:500,max_duration_seconds:3600}});
      if(url.pathname.endsWith('/retry')) {retries++;expect(url.searchParams.has('translation_language')).toBe(false);return route.fulfill({json:{status:'queued'}});}
      if(request.method()==='PATCH') {video.segments[0].translation_id=request.postDataJSON().translation_id;return route.fulfill({json:{saved:true}});}
      if(url.pathname.endsWith('/media')) return route.fulfill({path:'public/demo.mp4',contentType:'video/mp4'});
      return route.fulfill({json:video});
    });
    await page.goto('/');
    await page.getByLabel('Your videos').selectOption('saved');
    await expect(page.locator('.column-labels')).toContainText(`${name} translation`);
    await expect(page.locator('.translation')).toHaveAttribute('lang',language);
    if(language==='id') await expect(page.getByText(/Retries keep Indonesian/)).toBeVisible();
    await page.getByRole('button',{name:'Edit segment 00:00'}).click();
    await expect(page.getByRole('textbox',{name:`${name} translation`,exact:true})).toHaveValue(text);
    await page.getByRole('textbox',{name:`${name} translation`,exact:true}).fill(`${text}!`);
    await page.getByRole('button',{name:'Save corrections'}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.translation')).toContainText(`${text}!`);
    await page.getByRole('button',{name:'Retry translation',exact:true}).click();
    await expect.poll(()=>retries).toBe(1);
    await expect(page.getByRole('option',{name:`SRT · ${name}`,exact:true})).toHaveCount(1);
    if(language==='id') await expect(page.getByRole('option',{name:'SRT · English',exact:true})).toHaveCount(0);
  });
}
