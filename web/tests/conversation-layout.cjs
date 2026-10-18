// Offline browser regression: DIANA_PLAYWRIGHT_MODULE may point to an existing Playwright install.
const { chromium } = require(process.env.DIANA_PLAYWRIGHT_MODULE || 'playwright');
const esbuild = require('../../infra/node_modules/esbuild');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'diana-layout-'));
const mock = `import React from 'react';
const listeners={};window.actions=[];
window.room={name:'diana_test',state:'connected',on(e,f){(listeners[e]??=new Set()).add(f)},off(e,f){listeners[e]?.delete(f)},localParticipant:{async publishData(data){window.actions.push(JSON.parse(new TextDecoder().decode(data)))}}};
window.deliver=(topic,card)=>listeners.data?.forEach(f=>f(new TextEncoder().encode(JSON.stringify({...card,room:'diana_test'})),{kind:4},null,topic));
export function useSessionContext(){return {room:window.room,isConnected:true}};
export function useSessionMessages(){return {messages:[{id:'private-transcript',timestamp:1,from:{isLocal:false},message:'Spoken reply for transcript testing'}]}};
export function useLocalParticipant(){return {isCameraEnabled:false}};
export function useVoiceAssistant(){return {state:'listening'}};
export function VideoTrack(){return null};`;
(async () => {
  await esbuild.build({
    stdin: {
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {MediaProvider} from '${root}/web/components/app/media.tsx';import {ConversationContext} from '${root}/web/components/app/conversation-context.tsx';import {AgentSessionView_01} from '${root}/web/components/agents-ui/blocks/agent-session-view-01/components/agent-session-block.tsx';createRoot(document.getElementById('root')).render(<MediaProvider><ConversationContext><AgentSessionView_01/></ConversationContext></MediaProvider>);`,
      resolveDir: root + '/web',
      loader: 'tsx',
    },
    bundle: true,
    loader: { '.css': 'empty' },
    outfile: temp + '/app.js',
    jsx: 'automatic',
    alias: { '@': root + '/web' },
    plugins: [
      {
        name: 'mocks',
        setup(b) {
          b.onResolve(
            {
              filter:
                /^(@livekit\/components-react|livekit-client|@\/lib\/cognito-auth|@\/components\/agents-ui\/agent-control-bar|@\/components\/agents-ui\/agent-audio-visualizer-bar|@\/components\/app\/attachments|\.\/tile-view)$/,
            },
            (a) => ({ path: a.path, namespace: 'mock' })
          );
          b.onLoad({ filter: /.*/, namespace: 'mock' }, (a) => ({
            loader: 'jsx',
            resolveDir: root + '/web',
            contents:
              a.path === 'livekit-client'
                ? `export const Track={Source:{Camera:'camera'}};export const ParticipantKind={AGENT:4};export const RoomEvent={DataReceived:'data',Connected:'connected',Reconnected:'reconnected'};`
                : a.path.includes('cognito')
                  ? `export async function authentication(){throw Error('No live requests allowed')};export async function accessToken(){return ''}`
                  : a.path.includes('agent-control-bar')
                    ? `export function AgentControlBar({onIsChatOpenChange,isChatOpen}){return <nav aria-label="Voice assistant controls" className="flex h-14 items-center justify-between"><button>Microphone</button><button onClick={()=>onIsChatOpenChange(!isChatOpen)}>Toggle transcript</button><button>End</button></nav>}`
                    : a.path.includes('agent-audio-visualizer')
                      ? `export function AgentAudioVisualizerBar(){return <span>◉</span>}`
                      : a.path.includes('attachments')
                        ? `export function Attachments(){return <button className="min-h-11">Share a file</button>}`
                        : a.path === './tile-view'
                          ? `export function TileLayout(){return <div className="grid h-full place-items-center" data-testid="large-voice">Voice animation</div>};export function useLocalTrackRef(){return undefined}`
                          : mock,
          }));
        },
      },
    ],
  });
  const cssDir = root + '/web/out/_next/static/css';
  const css = fs
    .readdirSync(cssDir)
    .filter((x) => x.endsWith('.css'))
    .map((x) => fs.readFileSync(cssDir + '/' + x))
    .join('\n');
  const server = http
    .createServer((req, res) => {
      res.setHeader('Content-Type', req.url === '/app.js' ? 'text/javascript' : 'text/html');
      res.end(
        req.url === '/app.js'
          ? fs.readFileSync(temp + '/app.js')
          : `<meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}html,body,#root{height:100%;margin:0}</style><div id="root"></div><script src="/app.js"></script>`
      );
    })
    .listen(0, '127.0.0.1');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    for (const size of [
      { width: 390, height: 844 },
      { width: 1280, height: 900 },
    ]) {
      console.log('Checking', size.width);
      const page = await browser.newPage({ viewport: size });
      page.setDefaultTimeout(15000);
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.route('https://**/*', (r) => r.fulfill({ status: 200, body: '' }));
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.getByTestId('large-voice').waitFor();
      await page.evaluate(() =>
        window.deliver('diana.sources', {
          id: 'first',
          query: 'Headphones for commuting',
          retrievedAt: new Date().toISOString(),
          sources: Array.from({ length: 8 }, (_, i) => ({
            title: 'Headphones option ' + i,
            url: 'https://www.amazon.com/dp/B00000000' + i,
            description: 'A useful description from the source to compare these headphones.',
          })),
        })
      );
      await page.getByRole('button', { name: 'Back to voice', exact: true }).waitFor();
      await page.getByRole('link', { name: /Headphones option 0/ }).waitFor();
      assert.equal(
        await page.getByText('Spoken reply for transcript testing', { exact: true }).count(),
        0
      );
      await page.getByRole('button', { name: 'Toggle transcript', exact: true }).click();
      await page.getByText('Spoken reply for transcript testing', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Toggle transcript', exact: true }).click();
      assert.equal(
        await page.getByText('Spoken reply for transcript testing', { exact: true }).count(),
        0
      );
      assert.equal(await page.getByTestId('large-voice').count(), 0);
      await page.getByRole('button', { name: 'Show 5 more results' }).click();
      assert.equal(await page.getByRole('link').count(), 8);
      await page.waitForTimeout(1000);
      const controls = await page.getByRole('navigation').boundingBox();
      assert(
        controls.y + controls.height <= size.height + 1,
        'controls remain onscreen: ' + JSON.stringify(controls)
      );
      await page.getByRole('button', { name: 'Back to voice', exact: true }).click();
      await page.getByTestId('large-voice').waitFor();
      await page.getByRole('button', { name: 'Conversation', exact: true }).click();
      assert.equal(await page.getByRole('link').count(), 8, 'expansion retained');
      const feed = page.getByRole('region', { name: 'Conversation', exact: true });
      await feed.evaluate((el) => {
        el.scrollTop = 0;
        el.dispatchEvent(new Event('scroll'));
      });
      await page.evaluate(() =>
        window.deliver('diana.sources', {
          id: 'second',
          query: 'More choices',
          retrievedAt: new Date().toISOString(),
          sources: [{ title: 'Article', url: 'https://example.org/article' }],
        })
      );
      console.log(
        'Scroll',
        await feed.evaluate((el) => ({
          top: el.scrollTop,
          height: el.clientHeight,
          total: el.scrollHeight,
        }))
      );
      await page.getByRole('button', { name: 'New results' }).waitFor();
      assert.equal(await feed.evaluate((el) => el.scrollTop), 0, 'reading position retained');
      await page.getByRole('button', { name: 'New results' }).click();
      await page.getByRole('link', { name: /Article/ }).waitFor();
      await page.evaluate(() =>
        window.deliver('diana.media', {
          id: 'video',
          title: 'Waves',
          kind: 'video',
          origin: 'web',
          status: 'ready',
          url: 'https://example.org/waves.mp4',
        })
      );
      await page.getByRole('button', { name: 'Open video', exact: true }).click();
      await page.waitForFunction(() => window.actions.at(-1).playing === true);
      await page.getByRole('button', { name: 'Close media' }).click();
      await page.waitForFunction(() => window.actions.at(-1).playing === false);
      await page.getByRole('button', { name: 'Open video', exact: true }).click();
      await page.waitForFunction(() => window.actions.at(-1).playing === true);
      const popupPromise = page.waitForEvent('popup');
      await page.getByRole('link', { name: 'Open original', exact: true }).click();
      const popup = await popupPromise;
      await popup.close();
      await page.waitForFunction(() => window.actions.at(-1).playing === false);
      assert.equal(await page.getByRole('button', { name: 'Close media' }).count(), 0,
        'external video link must release the dialog mute');
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `/tmp/diana-layout-${size.width}.png`, fullPage: true });
      await page.close();
    }
    console.log(
      'PASS: mobile/desktop content mode, automatic links, expandable groups, voice toggle, scroll preservation, fixed controls, and video pause/resume.'
    );
  } finally {
    await browser.close();
    server.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
