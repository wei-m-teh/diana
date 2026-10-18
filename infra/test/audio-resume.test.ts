import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachAudioResume } from '../../web/lib/audio-resume';
function setup() {
  const page = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const browser = new EventTarget();
  const listeners = new Map();
  let calls = 0, muted = false, reject = false;
  const room = {state: 'connected', startAudio: async () => { calls++; if(reject) throw Error('Autoplay blocked'); }, on: (e: string, f: () => void) => listeners.set(e,f), off: (e: string) => listeners.delete(e)};
  const dispose = attachAudioResume(room as any, () => muted, page as any, browser as any);
  return {page,browser,room,listeners,dispose,get calls(){return calls;},mute(v:boolean){muted=v;},block(){reject=true;}};
}
const settle = () => new Promise(resolve => setImmediate(resolve));
test('return from external video resumes audio without reconnecting', async () => {
  const x=setup(); await settle(); const initial=x.calls;
  x.page.visibilityState='hidden'; x.page.dispatchEvent(new Event('visibilitychange')); await settle(); assert.equal(x.calls,initial);
  x.page.visibilityState='visible'; x.page.dispatchEvent(new Event('visibilitychange')); x.browser.dispatchEvent(new Event('focus')); await settle();
  assert.equal(x.calls,initial+1,'coalesce overlapping return events');
  x.browser.dispatchEvent(new Event('pageshow')); await settle(); assert.equal(x.calls,initial+2);
  x.dispose(); x.browser.dispatchEvent(new Event('focus')); await settle(); assert.equal(x.calls,initial+2);
});
test('never unmute an active video or resume a disconnected call', async () => {
  const x=setup(); await settle(); const initial=x.calls;
  x.mute(true); x.browser.dispatchEvent(new Event('focus')); await settle(); assert.equal(x.calls,initial);
  x.mute(false); x.room.state='disconnected'; x.browser.dispatchEvent(new Event('focus')); await settle(); assert.equal(x.calls,initial);
  x.room.state='connected'; x.browser.dispatchEvent(new Event('focus')); await settle(); assert.equal(x.calls,initial+1); x.dispose();
});
test('autoplay rejection is handled and a later return can retry', async () => {
  const x=setup(); await settle(); x.block(); x.browser.dispatchEvent(new Event('focus')); await settle(); const failed=x.calls;
  x.browser.dispatchEvent(new Event('focus')); await settle(); assert.equal(x.calls,failed+1); x.dispose(); assert.equal(x.listeners.size,0);
});
