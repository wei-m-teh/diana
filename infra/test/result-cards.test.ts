import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSearchSources, linkLabel } from '../../web/lib/search-sources';

test('result cards deduplicate URLs and validate optional previews', () => {
 const result = parseSearchSources({id:'q',query:'Headphones',retrievedAt:'2026-10-03T12:00:00Z',sources:[
 {title:'Headphones',url:'https://www.amazon.com/dp/B000000001',description:'A source excerpt',imageUrl:'https://images.example.org/a.jpg'},
 {title:'Duplicate',url:'https://www.amazon.com/dp/B000000001'},
 {title:'Unsafe',url:'https://127.0.0.1/private'},
 {title:'Article',url:'https://example.org/article',imageUrl:'javascript:alert(1)'},
 ]});
 assert.equal(result?.sources.length,2);
 assert.equal(result?.sources[0].description,'A source excerpt');
 assert.equal(result?.sources[1].imageUrl,undefined);
 assert.equal(linkLabel('https://www.amazon.com/s?k=headphones'),'Search on Amazon');
 assert.equal(linkLabel('https://www.amazon.com/dp/B000000001'),'View on Amazon');
 assert.equal(linkLabel('https://example.org/article'),'Visit website');
});
