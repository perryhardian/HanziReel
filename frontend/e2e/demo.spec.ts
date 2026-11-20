import {test,expect} from '@playwright/test';

test('demo seeks, follows boundaries, replays one segment, and exports',async({page})=>{
  const errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Percakapan: rencana hari ini'})).toBeVisible();
  await page.locator('video').evaluate(async (v:HTMLVideoElement)=>{v.muted=true;await new Promise<void>(resolve=>{if(v.readyState>=1)resolve();else v.addEventListener('loadedmetadata',()=>resolve(),{once:true});});});
  await page.getByRole('button',{name:/Putar dari 00:04/}).click();
  await expect(page.locator('[data-segment="2"]')).toHaveAttribute('aria-current','true');
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeGreaterThan(4.2);
  await page.locator('video').evaluate((v:HTMLVideoElement)=>{v.pause();v.currentTime=8;});
  await expect(page.locator('[data-segment="3"]')).toHaveAttribute('aria-current','true');
  await page.getByRole('button',{name:'Putar ulang segmen 00:00'}).click();
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.paused),{timeout:7000}).toBe(true);
  const end=await page.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime);
  expect(end).toBeCloseTo(4,1);
  await page.getByLabel('Ikuti dialog').uncheck();
  await expect(page.getByLabel('Ikuti dialog')).not.toBeChecked();
  const download=page.waitForEvent('download');
  await page.getByLabel('Ekspor').selectOption('srt-hanzi');
  expect((await download).suggestedFilename()).toBe('hanzireel-demo.srt');
  await page.screenshot({path:'../artifacts/desktop.png',fullPage:true});
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('narrow viewport has no horizontal overflow',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await expect(page.getByRole('heading',{name:/Transkrip/})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'../artifacts/mobile.png',fullPage:true});
});
