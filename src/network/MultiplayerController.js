import * as THREE from 'three';
import { MultiplayerClient, SnapshotInterpolator } from './MultiplayerClient.js';

export class MultiplayerController extends EventTarget{
  constructor(scene){super();this.scene=scene;this.client=new MultiplayerClient();this.interp=new SnapshotInterpolator(100);this.remotes=new Map();this.enabled=false;this.client.addEventListener('state',e=>this.interp.push(e.detail));this.client.addEventListener('gameevent',e=>this.dispatchEvent(new CustomEvent('gameevent',{detail:e.detail})))}
  async connect(url,room){await this.client.connect(url,room);this.enabled=true;return this}
  makeProxy(){const g=new THREE.Group();const body=new THREE.Mesh(new THREE.CapsuleGeometry(.38,1.05,4,8),new THREE.MeshStandardMaterial({color:0x58646c,roughness:.75}));body.position.y=1.05;body.castShadow=true;const head=new THREE.Mesh(new THREE.SphereGeometry(.24,12,8),new THREE.MeshStandardMaterial({color:0x796e64,roughness:.8}));head.position.y=1.9;head.castShadow=true;g.add(body,head);this.scene.add(g);return g}
  update(now,local){if(!this.enabled)return;this.client.update(now,local);for(const[id]of this.client.remote){let p=this.remotes.get(id);if(!p){p=this.makeProxy();this.remotes.set(id,p)}const s=this.interp.sample(id,Date.now());if(!s)continue;p.position.set(s.x,s.y-(s.height||1.72),s.z);p.rotation.y=s.yaw||0}}
  fire(payload){if(this.enabled)this.client.fire(payload)}
  close(){this.client.close();for(const p of this.remotes.values())this.scene.remove(p);this.remotes.clear();this.enabled=false}
}
