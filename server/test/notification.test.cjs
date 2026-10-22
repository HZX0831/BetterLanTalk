const {test}=require('node:test'),assert=require('node:assert/strict'),dgram=require('node:dgram');
const {once}=require('node:events');const {fixture}=require('./fixture.cjs');
test('real UDP delivery honors per-group mute and mention filters before applying the device cooldown',{timeout:10000},async t=>{
 const f=await fixture();t.after(f.cleanup);const api=f.api;
 const udp=dgram.createSocket('udp4');udp.bind(0,'0.0.0.0');await once(udp,'listening');t.after(()=>udp.close());const packets=[];udp.on('message',packet=>packets.push(packet));
 const admin=await api('/api/login',null,{method:'POST',body:{username:'admin',password:'=Aa1357924680'}}), people={};
 for(const username of ['alice','bob']){const login=await api('/api/register',null,{method:'POST',body:{username,password:'notify-password'}});people[username]={...login,...await api('/api/me',login.token)};}
 const {alice,bob}=people;
 await api('/api/config',admin.token,{method:'PUT',body:{jiyuEnabled:true,jiyuPort:udp.address().port}});
 await api('/api/rooms/default/settings',admin.token,{method:'PUT',body:{notificationMode:'none'}});
 const settings=mode=>api('/api/rooms/default/settings',bob.token,{method:'PUT',body:{notificationMode:mode}});
 async function send(body){await api('/api/rooms/default/messages',alice.token,{method:'POST',body});await new Promise(resolve=>setTimeout(resolve,50));}
 await settings('none');await send({content:'@bob muted',mentions:[{type:'user',userId:bob.id,start:0,end:4}]});assert.equal(packets.length,0);
 await settings('important');await send({content:'ordinary muted'});assert.equal(packets.length,0);
 await send({content:'@admin not Bob',mentions:[{type:'user',userId:(await api('/api/me',admin.token)).id,start:0,end:6}]});assert.equal(packets.length,0);
 await send({content:'@bob important',mentions:[{type:'user',userId:bob.id,start:0,end:4}]});assert.equal(packets.length,1);
 assert.equal(packets[0].subarray(56).toString('utf16le').replace(/\0.*$/s,''),'from alice: new message');
 await settings('all');await send({content:'cooldown still wins'});assert.equal(packets.length,1);
 assert.equal((await api('/api/rooms/default/messages',bob.token)).length,5,'notification filters never discard chat messages');
});
