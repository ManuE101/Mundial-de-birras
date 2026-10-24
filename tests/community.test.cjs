const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function community(hash, profile, profiles=[]) {
  const elements=new Map(), listeners=new Map(), bodyAttributes=new Set();
  const searches=[];
  function element(id) {
    if(!elements.has(id))elements.set(id,{
      hidden:false,innerHTML:'',value:'',textContent:'',open:false,
      handlers:{},addEventListener(name,callback){this.handlers[name]=callback;},
      reset(){},removeAttribute(){},focus(){},close(){this.open=false;},showModal(){this.open=true;}
    });
    return elements.get(id);
  }
  const context={
    window:{location:{hash,pathname:'/',search:''},addEventListener(name,callback){listeners.set(name,callback);},BirrasSecurity:{safePhotoUrl(){return '';}}},
    document:{getElementById:element,querySelectorAll(){return [];},addEventListener(){},body:{toggleAttribute(name,value){value?bodyAttributes.add(name):bodyAttributes.delete(name);}}},
    BirrasCloud:{publicProfile:async()=>profile,publicProfiles:async(search)=>{searches.push(search);return profiles;},ownProfile:async()=>null},
    displayStyle:value=>value,setInterval(){},history:{replaceState(){}}
  };
  vm.runInNewContext(fs.readFileSync('community.js','utf8'),context);
  return {element,listeners,bodyAttributes,searches};
}
test('a profile page can be opened without a session and escapes user content', async()=>{
  const {element,listeners,bodyAttributes}=community('#/perfil/manu',{
    username:'manu',created_at:'2026-10-23',review_count:1,average:8,
    reviews:[{id:'one',brand:'<img src=x onerror=alert(1)>',name:'<script>alert(1)</script>',style:'IPA',rating:8,notes:'<svg onload=alert(1)>',date:null,buy_again:null}]
  });
  await listeners.get('birras:session')({detail:{user:null,recovering:false}});
  await new Promise(resolve=>setImmediate(resolve));
  const html=element('public-content').innerHTML;
  assert.equal(element('public-content').hidden,false);
  assert.ok(bodyAttributes.has('data-public-view'));
  assert.match(html,/@manu/);
  assert.match(html,/&lt;script&gt;/);
  assert.doesNotMatch(html,/<script>|<svg|onerror="/);
  assert.equal(element('my-profile-link').hidden,true);
});
test('private personal route never renders a public profile',()=>{
  const {element,bodyAttributes}=community('#/',null);
  assert.equal(element('public-content').hidden,true);
  assert.equal(bodyAttributes.has('data-public-view'),false);
});
test('unknown public usernames produce a clear empty state',async()=>{
  const {element,listeners}=community('#/perfil/inexistente',null);
  await listeners.get('birras:session')({detail:{user:null,recovering:false}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(element('public-content').innerHTML,/Perfil no encontrado/);
});

test('community lists profiles only after searching and clears them with an empty query',async()=>{
  const {element,listeners,searches}=community('#/comunidad',null,[{username:'manu',avatar:null}]);
  await listeners.get('birras:session')({detail:{user:null,recovering:false}});
  assert.equal(searches.length,0);
  assert.doesNotMatch(element('public-content').innerHTML,/@manu/);
  element('profile-search').value='man';
  element('profile-search-form').handlers.submit({preventDefault(){}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(searches,['man']);
  assert.match(element('public-content').innerHTML,/@manu/);
  element('profile-search').value='';
  element('profile-search').handlers.input();
  assert.doesNotMatch(element('public-content').innerHTML,/@manu/);
  assert.equal(searches.length,1);
});
