import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseLocationFix, validLocationPreference } from '../../web/lib/location';
const now = Date.parse('2026-09-28T00:00:00Z');
const fix = {latitude:47.60621,longitude:-122.33207,accuracyMeters:20,capturedAt:new Date(now).toISOString()};
test('coordinates are bounded, time checked and precision reduced', () => {
  assert.deepEqual(parseLocationFix(fix,now), {...fix,latitude:47.61,longitude:-122.33,accuracyMeters:1000});
  for (const patch of [{latitude:91},{longitude:Infinity},{accuracyMeters:-1},{capturedAt:'bad'},{capturedAt:new Date(now-700000).toISOString()},{capturedAt:new Date(now+700000).toISOString()}]) assert.equal(parseLocationFix({...fix,...patch},now),null);
});
test('location preference accepts only explicit off/device/manual city', () => {
  for (const v of [{mode:'off'},{mode:'device'},{mode:'manual',city:'Seattle, WA, USA'}]) assert.ok(validLocationPreference(v));
  for (const v of [null,{}, {mode:'manual',city:''},{mode:'device',city:'x'},{mode:'manual',city:'a\nb'}]) assert.equal(validLocationPreference(v),false);
});

test('browser location denial does not block a conversation and successful fixes are rounded', async () => {
  const { deviceLocation } = await import('../../web/lib/device-location');
  const descriptor = Object.getOwnPropertyDescriptor(globalThis,'navigator');
  try {
    Object.defineProperty(globalThis,'navigator',{configurable:true,value:{geolocation:{getCurrentPosition: (_ok:any, fail:any) => fail({code:1})}}});
    assert.equal(await deviceLocation(),null);
    Object.defineProperty(globalThis,'navigator',{configurable:true,value:{geolocation:{getCurrentPosition: (ok:any) => ok({timestamp:Date.now(),coords:{latitude:47.60621,longitude:-122.33207,accuracy:10}})}}});
    assert.equal((await deviceLocation())?.latitude,47.61);
  } finally {
    if(descriptor) Object.defineProperty(globalThis,'navigator',descriptor);
    else Reflect.deleteProperty(globalThis,'navigator');
  }
});

test('city lookup stores only locality/region/country and fails softly', async () => {
  const { createCityLookup } = await import('../lambda/location');
  const lookup = createCityLookup({send: async (command:any) => {
    assert.equal(command.input.IntendedUse,'Storage');
    assert.deepEqual(command.input.QueryPosition,[-122.33207,47.60621]);
    return {ResultItems:[{Address:{Locality:'Seattle',Region:{Name:'Washington'},Country:{Name:'USA'},Label:'Private full address',AddressNumber:'123',Street:'Private street'}}]};
  }} as any);
  assert.equal(await lookup(fix),'Seattle, Washington, USA');
  assert.equal(await createCityLookup({send:async()=>{throw new Error('provider detail');}} as any)(fix),null);
});
