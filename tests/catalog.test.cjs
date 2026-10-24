const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function setup(api){
  const elements=new Map();
  const element=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',value:'',disabled:false,handlers:{},addEventListener(name,fn){this.handlers[name]=fn;}});return elements.get(id);};
  const context={window:{BirrasSecurity:{safePhotoUrl(){return null;}}},document:{getElementById:element},BirrasCloud:api,displayStyle:s=>s};
  vm.runInNewContext(fs.readFileSync('catalog.js','utf8'),context);
  return {element,render:context.window.BirrasCatalog.render};
}
test('catalog escapes public content, combines search and keeps rating creation out of the page',async()=>{
  const queries=[],refreshes=[];
  const {element,render}=setup({catalog:async search=>{queries.push(search);return {total:1,items:[{key:'a'.repeat(32),brand:'<script>',name:'Birra',average:7,review_count:2,styles:['Roja']}]};}});
  await render({type:'catalog'},0,null,()=>true,n=>refreshes.push(n));
  const html=element('public-content').innerHTML;
  assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>|type="number"|Agregar cerveza/);
  element('catalog-search').value='marca roja';element('catalog-search-form').handlers.submit({preventDefault(){}});
  assert.deepEqual(refreshes,[0]);
  await render({type:'catalog'},0,null,()=>true,()=>{});
  assert.deepEqual(queries,['','marca roja']);
});
test('catalog detail saves wishlist only for signed in users who have not tried it',async()=>{
  const changes=[];
  const detail={brand:'Marca',name:'Birra',average:8,review_count:1,buy_answers:1,buy_yes:1,reviews:[{username:'manu',rating:8,notes:'<img>',buy_again:true}],tried:false,saved:false};
  const {element,render}=setup({catalogDetail:async()=>detail,setWishlist:async(...args)=>changes.push(args)});
  await render({type:'beer',key:'one'},0,{id:'user'},()=>true,()=>{});
  assert.match(element('public-content').innerHTML,/Agregar a Por probar/);
  assert.match(element('public-content').innerHTML,/&lt;img&gt;/);
  await element('wishlist-toggle').handlers.click();assert.deepEqual(changes,[['one',true]]);
  detail.tried=true;
  await render({type:'beer',key:'one'},0,{id:'user'},()=>true,()=>{});
  assert.doesNotMatch(element('public-content').innerHTML,/id="wishlist-toggle"/);
  await render({type:'beer',key:'one'},0,null,()=>true,()=>{});
  assert.match(element('public-content').innerHTML,/Iniciá sesión/);
});
test('stale catalogue responses cannot replace the active page',async()=>{
  const {element,render}=setup({catalog:async()=>({total:0,items:[]})});
  element('public-content').innerHTML='Nueva página';
  await render({type:'catalog'},0,null,()=>false,()=>{});
  assert.equal(element('public-content').innerHTML,'Nueva página');
});
