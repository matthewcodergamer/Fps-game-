import { WebSocketServer } from 'ws';

const port=Number(process.env.PORT||8080);
const wss=new WebSocketServer({port});
const rooms=new Map();

function join(ws,room,id){
  ws.room=room;ws.id=id;if(!rooms.has(room))rooms.set(room,new Set());rooms.get(room).add(ws);
  broadcast(room,{t:'peer-joined',id},ws);
}
function leave(ws){const set=rooms.get(ws.room);if(!set)return;set.delete(ws);broadcast(ws.room,{t:'peer-left',id:ws.id},ws);if(!set.size)rooms.delete(ws.room)}
function broadcast(room,msg,except=null){const data=JSON.stringify(msg);for(const c of rooms.get(room)||[])if(c!==except&&c.readyState===1)c.send(data)}

wss.on('connection',ws=>{
  ws.on('message',raw=>{let m;try{m=JSON.parse(raw)}catch{return}
    if(m.t==='join'){join(ws,String(m.room||'PUBLIC').slice(0,24),m.id);ws.send(JSON.stringify({t:'joined',room:ws.room,id:ws.id}));return}
    if(!ws.room)return;
    if(m.t==='state'||m.t==='event')broadcast(ws.room,m,ws);
  });
  ws.on('close',()=>leave(ws));
});
console.log(`Project Strike relay listening on :${port}`);
