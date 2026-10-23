const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { test } = require('node:test');
const { fixture, receive } = require('./fixture.cjs');
const password = 'roles-password';
const seed = {
 'users.json': { users: ['admin','manager','outsider'].map((username,i) => ({ username, role: i ? 'user' : 'superadmin', salt: username, passwordHash: crypto.scryptSync(password,username,64).toString('hex'), registeredIp:'', createdAt:i+1 })), tokens:{} },
 'rooms.json': { membershipVersion:2, rooms:[{ id:'legacy', name:'旧群', kind:'group', isPublic:true, createdBy:'admin', members:[], created:1 }] },
 'messages.json': { rooms:{ legacy:[{ id:'retained', content:'archive history', timestamp:1 }], default:[{ id:'retained-default', content:'default history', timestamp:2 }] } }
};
test('archived legacy groups, independent site/group roles, live authorization and persistent membership', { timeout:20000 }, async t => {
 const f = await fixture(seed); t.after(f.cleanup); const api=f.api, auth={};
 for (const username of ['admin','manager','outsider']) { const login=await api('/api/login',null,{method:'POST',body:{username,password}}); auth[username]={...login,...await api('/api/me',login.token)}; }
 const {admin,manager,outsider}=auth; let m=await f.connect(manager.token), o=await f.connect(outsider.token); let group,file;
 const rejected=async(socket,event,data,pattern)=>{const result=receive(socket,'error');socket.emit(event,data);assert.match(await result,pattern);};
 await t.test('upgrades preserve account passwords, default history and archived records without exposing old groups',async()=>{
  assert.equal(admin.role,'superadmin');
  assert.deepEqual((await api('/api/rooms',manager.token)).map(room=>room.id),['default']);
  await api('/api/rooms/legacy/messages',manager.token,{status:403});
  const archive=JSON.parse(fs.readFileSync(path.join(f.dir,'messages.json'),'utf8'));assert.equal(archive.rooms.legacy[0].id,'retained');
  assert.equal((await api('/api/rooms/default/messages',manager.token))[0].id,'retained-default');
  assert.ok(fs.existsSync(path.join(f.dir,'users.json.pre-social.bak')));
  await api('/api/rooms',manager.token,{method:'POST',body:{roomId:'old-api'},status:410});
  await rejected(m,'create_room',{roomId:'old-socket'},/停用/);
 });
 await t.test('ordinary users own groups; global management views do not expose private content or confer group powers',async()=>{
  group=(await api('/api/groups',manager.token,{method:'POST',body:{name:'私有项目',isPublic:false}})).room;
  await api('/api/rooms/'+group.id+'/messages',admin.token,{status:403});
  await api('/api/groups/'+group.id,admin.token,{status:403});
  const overview=(await api('/api/rooms?manage=1',admin.token)).find(room=>room.id===group.id);assert.equal(overview.lastMessage,null);assert.equal(overview.canManage,false);assert.equal(overview.members,undefined);
  await api('/api/rooms?manage=1',outsider.token,{status:403});
  await rejected(o,'join_room',{roomId:group.id},/未获邀请/);
  await rejected(o,'send_message',{roomId:group.id,content:'bypass'},/无权/);
  const body={method:'POST',body:'private file',headers:{'content-type':'application/octet-stream','x-filename':'private.txt','x-mime':'text/plain'}};
  await api('/api/upload?room='+group.id,outsider.token,{...body,status:403});file=(await api('/api/upload?room='+group.id,manager.token,body)).file;
  await api(file.url,admin.token,{status:403});await api(file.url,outsider.token,{status:403});
  const result=receive(m,'message',msg=>msg.content==='private secret');m.emit('send_message',{roomId:group.id,content:'private secret'});await result;
  assert.equal((await api('/api/rooms?manage=1',admin.token)).find(room=>room.id===group.id).lastMessage,null);
 });
 await t.test('friend invitations require explicit acceptance; promoted site admins still need membership and group role',async()=>{
  await api('/api/groups/'+group.id+'/invitations',manager.token,{method:'POST',body:{userId:outsider.id},status:403});
  const request=(await api('/api/friend-requests',manager.token,{method:'POST',body:{userId:outsider.id}})).request;
  await api('/api/friend-requests/'+request.id,outsider.token,{method:'PUT',body:{action:'accept'}});
  const {invitation}=await api('/api/groups/'+group.id+'/invitations',manager.token,{method:'POST',body:{userId:outsider.id}});
  await api('/api/users/outsider/role',admin.token,{method:'PUT',body:{role:'admin'}});
  await api('/api/rooms/'+group.id+'/messages',outsider.token,{status:403});
  await api('/api/groups/'+group.id+'/join',outsider.token,{method:'POST',body:{invitationId:invitation.id}});
  assert.equal(await api(file.url,outsider.token),'private file');
  await api('/api/groups/'+group.id,outsider.token,{method:'PUT',body:{announcement:'site role bypass'},status:403});
  await api('/api/groups/'+group.id+'/members/'+outsider.id+'/role',manager.token,{method:'PUT',body:{role:'admin'}});
  await api('/api/groups/'+group.id,outsider.token,{method:'PUT',body:{announcement:'group admin'}});
  await api('/api/groups/'+group.id+'/members/'+manager.id,outsider.token,{method:'DELETE',status:403});
 });
 await t.test('site demotion leaves group ownership intact; group demotion immediately revokes powers on existing sessions',async()=>{
  await api('/api/users/manager/role',admin.token,{method:'PUT',body:{role:'admin'}});
  await api('/api/users/manager/role',admin.token,{method:'PUT',body:{role:'user'}});
  assert.equal((await api('/api/groups/'+group.id,manager.token)).groupRole,'owner');
  await api('/api/groups/'+group.id+'/members/'+outsider.id+'/role',manager.token,{method:'PUT',body:{role:'member'}});
  await api('/api/groups/'+group.id,outsider.token,{method:'PUT',body:{announcement:'stale role'},status:403});
  await rejected(o,'send_message',{roomId:group.id,content:'@全体成员',mentions:[{type:'all',start:0,end:5}]},/群主|群管理员/);
  await api('/api/users/outsider/role',admin.token,{method:'PUT',body:{role:'user'}});
  await api('/client/admin.js',outsider.token,{status:403});
  await api('/api/users/outsider',admin.token,{method:'PUT',body:{newUsername:'renamed'}});
  assert.equal((await api('/api/rooms/'+group.id+'/members',manager.token)).find(person=>person.id===outsider.id).username,'renamed');
 });
 await t.test('restart retains membership, messages and files; removal revokes every access path immediately',async()=>{
  await f.stop();await f.start();m=await f.connect(manager.token);o=await f.connect(outsider.token);
  assert.equal((await api('/api/groups/'+group.id,manager.token)).announcement,'group admin');
  assert.ok((await api('/api/rooms/'+group.id+'/messages',outsider.token)).some(message=>message.content==='private secret'));
  assert.equal(await api(file.url,outsider.token),'private file');
  const joined=receive(o,'room_joined');o.emit('join_room',{roomId:group.id});await joined;
  const kicked=receive(o,'kicked_from_room');await api('/api/groups/'+group.id+'/members/'+outsider.id,manager.token,{method:'DELETE'});await kicked;
  await api(file.url,outsider.token,{status:403});await api('/api/rooms/'+group.id+'/messages',outsider.token,{status:403});
  await rejected(o,'send_message',{roomId:group.id,content:'removed'},/无权/);
  await api('/api/groups/'+group.id,admin.token,{method:'DELETE'});assert.ok(!(await api('/api/rooms',manager.token)).some(room=>room.id===group.id));
 });
});
