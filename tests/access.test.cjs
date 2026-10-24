const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup({ recovery = false, fail = false } = {}) {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      hidden: id === 'app-content', value: '', textContent: '',
      addEventListener(name, handler) { (this.listeners ||= {})[name] = handler; }, close() { this.open = false; }, showModal() { this.open = true; }, focus() {}, innerHTML: ''
    });
    return elements.get(id);
  }
  let reads = 0;
  const context = {
    document: { getElementById: element, addEventListener() {}, body: { classList: { toggle() {} } } },
    BirrasCloud: { isRecovering: () => recovery, list: async () => { reads++; if (fail) throw new Error('offline'); return []; } },
    setInterval() {}, clearTimeout() {}, setTimeout() { return 1; }
  };
  const source = fs.readFileSync('app.js', 'utf8').replace(/ init\(\);\s*$/, '');
  vm.runInNewContext(source, context);
  vm.runInNewContext('cloudMode = true;', context);
  return { context, element, reads: () => reads };
}

test('signed-out visitors only see access and never query the collection', async () => {
  const { context, element, reads } = setup();
  await context.loadSession(null);
  assert.equal(element('app-content').hidden, true);
  assert.equal(element('auth-form').hidden, false);
  assert.equal(reads(), 0);
});
test('successful sign-in reveals collection and logout hides it immediately', async () => {
  const { context, element } = setup();
  await context.loadSession({ id: 'owner', email: 'owner@example.com' });
  assert.equal(element('app-content').hidden, false);
  assert.equal(element('auth-form').hidden, true);
  await context.loadSession(null);
  assert.equal(element('app-content').hidden, true);
});
test('password recovery keeps the collection hidden', async () => {
  const { context, element, reads } = setup({ recovery: true });
  await context.loadSession({ id: 'owner' });
  assert.equal(element('app-content').hidden, true);
  assert.equal(element('new-password-form').hidden, false);
  assert.equal(reads(), 0);
});
test('a failed collection request does not reveal the app', async () => {
  const { context, element } = setup({ fail: true });
  await context.loadSession({ id: 'owner' });
  assert.equal(element('app-content').hidden, true);
  assert.match(element('status').textContent, /conexión/);
});

test('style and state filters combine with accent-insensitive search', () => {
  const { context } = setup();
  const beer = { brand: 'Patagonía', name: 'IPA', style: '  Hazy IPA ', drunk: false };
  assert.equal(context.matchesFilters(beer, 'patagonia', 'style:hazy ipa', 'no'), true);
  assert.equal(context.matchesFilters(beer, '', 'style:hazy ipa', 'yes'), false);
  assert.equal(context.matchesFilters(beer, '', 'style:lager', 'no'), false);
});
test('unspecified tasting state never matches explicitly sober', () => {
  const { context } = setup();
  const beer = { brand: 'Marca', name: 'Birra', style: '' };
  assert.equal(context.matchesFilters(beer, '', '__none__', 'unknown'), true);
  assert.equal(context.matchesFilters(beer, '', '', 'no'), false);
});
test('editing a custom style preserves its text and makes the field required', () => {
  const { context, element } = setup();
  context.setFormStyle('Hazy IPA');
  assert.equal(element('style').value, '__other__');
  assert.equal(element('custom-style').value, 'Hazy IPA');
  assert.equal(element('custom-style').required, true);
  assert.equal(context.readFormStyle(), 'Hazy IPA');
  element('custom-style').value = '   ';
  assert.throws(() => context.readFormStyle(), /estilo/);
});
test('preset matching normalizes case and hides the other field', () => {
  const { context, element } = setup();
  context.setFormStyle(' ipa ');
  assert.equal(element('style').value, 'IPA');
  assert.equal(element('custom-style').disabled, true);
  assert.equal(element('custom-style-label').hidden, true);
});

test('legacy red styles share the new Roja filter and preset', () => {
  const { context, element } = setup();
  for (const style of ['Amber Lager', 'Irish Red Ale (Roja)', 'Irish Red Ale']) {
    assert.equal(context.displayStyle(style), 'Roja');
    assert.equal(context.matchesFilters({ brand: 'Marca', name: 'Birra', style }, '', 'style:roja', ''), true);
    context.setFormStyle(style);
    assert.equal(element('style').value, 'Roja');
    assert.equal(element('custom-style').disabled, true);
  }
});

test('detail shows full record and shared global rank regardless of filters', () => {
  const { context, element } = setup();
  vm.runInNewContext(`loading = false; beers = [
    {id:'first', rating:10},
    {id:'target',brand:'Marca',name:'Birra',rating:8,style:'Amber Lager',date:'2026-10-21',drunk:false,notes:'Buena para la picada.',photo:'data:image/jpeg;base64,test'},
    {id:'tied',rating:8}
  ];`, context);
  element('filter-state').value = 'yes';
  context.openDetail('target');
  assert.equal(element('beer-detail').open, true);
  assert.equal(element('detail-title').textContent, 'Birra');
  assert.equal(element('detail-style').textContent, 'Roja');
  assert.equal(element('detail-position').textContent, 'Puesto 2 de 3 (compartido) en tu ranking');
  assert.equal(element('detail-notes').textContent, 'Buena para la picada.');
  assert.equal(element('detail-state').textContent, 'Probada sin estar borracho');
});

test('detail cannot open before the app is ready', () => {
  const { context, element } = setup();
  context.openDetail('missing');
  assert.notEqual(element('beer-detail').open, true);
});

test('statistics group aliases and include zero scores in the average', () => {
  const { context } = setup();
  const rows = context.groupStatistics([
    {style:'Amber Lager',rating:0}, {style:'Irish Red Ale',rating:10}, {style:'IPA',rating:6}
  ], beer => context.displayStyle(beer.style));
  const red = rows.find(row => row.label === 'Roja');
  assert.equal(rows.length, 2);
  assert.equal(red.count, 2);
  assert.equal(red.average, 5);
});
test('statistics use the whole collection and distinguish missing state from sober', () => {
  const { context, element } = setup();
  vm.runInNewContext(`beers = [
    {brand:'Marca',style:'IPA',rating:0,drunk:false},
    {brand:' marca ',style:'IPA',rating:10,drunk:null}
  ];`, context);
  element('search').value = 'no matches';
  context.renderStatistics();
  assert.match(element('stats-brands-count').innerHTML, /2<small> birras/);
  assert.match(element('stats-states').innerHTML, /Sin estar borracho/);
  assert.match(element('stats-states').innerHTML, /0,0/);
  assert.match(element('stats-states').innerHTML, /10,0/);
  assert.match(element('stats-states').innerHTML, /0 birras/);
});
test('the joke appears only on explicitly drunk tastings', () => {
  const { context } = setup();
  assert.equal(context.tastingJoke({drunk:true}), 'No era parámetro en esas condiciones.');
  assert.equal(context.tastingJoke({drunk:false}), '');
  assert.equal(context.tastingJoke({}), '');
});

test('duplicate detection ignores accents and spaces and excludes the record being edited', () => {
  const { context } = setup();
  vm.runInNewContext("beers = [{id:'one',brand:'Patagonía',name:'Amber Lager',rating:8}];", context);
  assert.equal(context.findDuplicate(' patagonia ', 'Amber  Lager').id, 'one');
  assert.equal(context.findDuplicate('patagonia', 'Amber Lager', 'one'), null);
  assert.equal(context.findDuplicate(' ', 'Amber Lager'), null);
});

test('canceling deletion leaves the beer intact without calling storage', async () => {
  const { context, element } = setup();
  context.confirm = () => false;
  context.BirrasCloud.remove = async () => assert.fail('deletion was canceled');
  vm.runInNewContext("loading=false; beers=[{id:'one',brand:'Marca',name:'Birra'}];", context);
  const event = {target:{closest: selector => selector === '[data-delete]' ? {dataset:{delete:'one'}} : null}};
  await element('ranking').listeners.click(event);
  assert.equal(vm.runInNewContext('beers.length', context), 1);
});
test('confirmed deletion removes a beer and storage failures preserve the view', async () => {
  for (const fail of [false,true]) {
    const { context, element } = setup();
    let calls=0;
    context.confirm = () => true;
    context.BirrasCloud.remove = async () => { calls++; if(fail) throw new Error('offline'); };
    vm.runInNewContext("loading=false; beers=[{id:'one',brand:'Marca',name:'Birra'}];", context);
    const event = {target:{closest: selector => selector === '[data-delete]' ? {dataset:{delete:'one'}} : null}};
    await element('ranking').listeners.click(event);
    assert.equal(calls,1);
    assert.equal(vm.runInNewContext('beers.length', context), fail ? 1 : 0);
  }
});
