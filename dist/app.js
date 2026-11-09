import * as T from 'three';
import {GLTFLoader} from './vendor/GLTFLoader.js';
import {advance,clamp,demoDuration,demoFlight,initialFlight,rideHeight,runway,startManeuver} from './physics.js?v=counterfire';
import {createWorld,heightAt} from './world.js';
import {createLite} from './lite.js?v=wing-guns';
import {initialCombatFlight,startCombat,advanceCombat} from './combat.js?v=missile-trail';
import {combatView} from './combat-view.js?v=missile-trail';
import {jetFinishMaterial,loadJetOcclusion} from './jet-finish.js?v=mirror-canopy';

import {createJetHardware} from './jet-hardware.js?v=wing-guns';
import {cockpitEye,cockpitFov,paintCockpit} from './cockpit-view.js';

const el=id=>document.getElementById(id);
const buttons={combat:el('combat-start'),gun:el('gun'),missile:el('missile'),start:el('start'),demo:el('demo'),camera:el('camera'),reset:el('reset'),home:el('home'),brake:el('brake')};
const power=el('power'), stick=el('stick'), mapCanvas=el('map').querySelector('canvas');
const map=mapCanvas.getContext('2d');
const keys=new Set(), touch={x:0,y:0,id:null,brake:false,press:null,lastTap:null};
let maneuverNotice=null;
const scene=new T.Scene();
const camera=new T.PerspectiveCamera(58,1,.13,15000);
const airframe=new T.Group();
const hardware=createJetHardware(airframe);
const showcase={x:-1400,y:188,z:450,heading:1.80,pitch:.018,bank:-.08,phase:'air',throttle:.64};
const weapons={gun:false,missile:false,gunTap:false,missileTap:false};
const effects=combatView(el('combat-view'));
let battle=null;
const headingRotation=new T.Quaternion();
const yAxis=new T.Vector3(0,1,0);
const modelPosition=new T.Vector3(), eye=new T.Vector3(), focus=new T.Vector3(), desired=new T.Vector3();
let renderWorld, renderer, lite, mode='intro', flight=initialFlight(), loaded=false, cockpit=false, elapsed=0;
let audio, lastText='', lastHud=0;
const mobile=navigator.maxTouchPoints>0||matchMedia('(any-pointer: coarse)').matches;
let viewWidth=innerWidth,viewHeight=innerHeight, portraitIntro=false;

function addShadow(){
  const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;
  const c=canvas.getContext('2d');
  const gradient=c.createRadialGradient(64,64,4,64,64,64);
  gradient.addColorStop(0,'rgba(12,14,15,.65)');gradient.addColorStop(.48,'rgba(12,14,15,.42)');gradient.addColorStop(1,'rgba(12,14,15,0)');
  c.fillStyle=gradient;c.fillRect(0,0,128,128);
  const mat=new T.MeshBasicMaterial({map:new T.CanvasTexture(canvas),transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2});
  const mesh=new T.Mesh(new T.PlaneGeometry(11,6),mat);mesh.rotation.x=-Math.PI/2;scene.add(mesh);return mesh;
}
function startAudio(){
  if(!audio){
    const Audio=window.AudioContext||window.webkitAudioContext;
    if(!Audio)return;
    try {
      const ctx=new Audio(), engine=ctx.createOscillator(), band=ctx.createBiquadFilter(), gain=ctx.createGain(), low=ctx.createGain();
      const wave=ctx.createBuffer(1,ctx.sampleRate*2,ctx.sampleRate), data=wave.getChannelData(0);
      for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;
      const noise=ctx.createBufferSource();noise.buffer=wave;noise.loop=true;
      band.type='lowpass';band.frequency.value=190;
      engine.type='triangle';engine.frequency.value=41;
      low.gain.value=.19;gain.gain.value=0;
      engine.connect(low).connect(gain);noise.connect(band).connect(gain);gain.connect(ctx.destination);
      engine.start();noise.start();audio={ctx,engine,band,gain,wave};
    } catch {return;}
  }
  if(audio.ctx.state==='suspended')audio.ctx.resume().catch(()=>{});
}
function weaponAudio(kind){
  if(!audio||audio.ctx.state!=='running')return;
  const ctx=audio.ctx, now=ctx.currentTime;
  if(kind==='destroyed'){
    const boom=ctx.createBufferSource(), filter=ctx.createBiquadFilter(), volume=ctx.createGain();
    boom.buffer=audio.wave;filter.type='lowpass';
    filter.frequency.setValueAtTime(1350,now);filter.frequency.exponentialRampToValueAtTime(72,now+.78);
    volume.gain.setValueAtTime(.001,now);volume.gain.linearRampToValueAtTime(.37,now+.021);
    volume.gain.exponentialRampToValueAtTime(.001,now+1.12);
    boom.connect(filter).connect(volume).connect(ctx.destination);boom.start(now);boom.stop(now+1.13);
    boom.onended=()=>{boom.disconnect();filter.disconnect();volume.disconnect();};
    return;
  }
  if(kind==='warning'){
    const tone=ctx.createOscillator(), volume=ctx.createGain();
    tone.type='triangle';tone.frequency.setValueAtTime(870,now);tone.frequency.setValueAtTime(1130,now+.13);
    volume.gain.setValueAtTime(.001,now);
    for(const delay of [0,.13,.26]){
      volume.gain.setValueAtTime(.001,now+delay);
      volume.gain.linearRampToValueAtTime(.09,now+delay+.02);
      volume.gain.exponentialRampToValueAtTime(.001,now+delay+.10);
    }
    tone.connect(volume).connect(ctx.destination);tone.start(now);tone.stop(now+.38);return;
  }
  if(kind==='missile'){
    const motor=ctx.createBufferSource(), filter=ctx.createBiquadFilter(), envelope=ctx.createGain();
    motor.buffer=audio.wave;filter.type='bandpass';filter.Q.value=.78;
    filter.frequency.setValueAtTime(760,now+.17);filter.frequency.exponentialRampToValueAtTime(165,now+.82);
    envelope.gain.setValueAtTime(.001,now);envelope.gain.linearRampToValueAtTime(.18,now+.24);
    envelope.gain.exponentialRampToValueAtTime(.001,now+.91);
    motor.connect(filter).connect(envelope).connect(ctx.destination);motor.start(now+.15);motor.stop(now+.92);
    motor.onended=()=>{motor.disconnect();filter.disconnect();envelope.disconnect();};
    return;
  }
  const duration=kind==='gun'?.045:.16;
  const osc=ctx.createOscillator(),gain=ctx.createGain();
  osc.type=kind==='gun'?'triangle':'sawtooth';
  osc.frequency.setValueAtTime(kind==='gun'?130:90,now);
  osc.frequency.exponentialRampToValueAtTime(38,now+duration);
  gain.gain.setValueAtTime(kind==='gun'?.027:.055,now);gain.gain.exponentialRampToValueAtTime(.001,now+duration);
  osc.connect(gain).connect(ctx.destination);osc.start();osc.stop(now+duration);
  osc.onended=()=>{osc.disconnect();gain.disconnect();};
}
function audioFrame(){
  if(!audio)return;
  const now=audio.ctx.currentTime, flying=mode!=='intro'&&flight.phase!=='crashed'&&!battle?.destruction;
  audio.engine.frequency.setTargetAtTime(42+flight.throttle*46+flight.speed*.22,now,.18);
  audio.band.frequency.setTargetAtTime(180+flight.speed*10+flight.throttle*250,now,.18);
  audio.gain.gain.setTargetAtTime(flying?.014+flight.speed*.00045+flight.throttle*.027:0,now,.14);
}
function resize(){
  const viewport=window.visualViewport;
  viewWidth=document.documentElement.clientWidth||innerWidth;
  viewHeight=Math.max(1,Math.round(viewport&&viewport.scale<=1?viewport.height:innerHeight));
  // Some phone browsers present a desktop-width page, then shrink it to the screen.
  const viewportScale=viewport?.scale||1;
  const screenScale=mobile&&screen.width>0&&screen.width<=600?viewWidth/screen.width:1;
  const hudScale=clamp(Math.max(1,screenScale,1/viewportScale),1,3);
  const hudWidth=viewWidth/hudScale,hudHeight=viewHeight/hudScale;
  const touchLayout=mobile||hudWidth<=700||hudScale>1;
  portraitIntro=touchLayout&&hudWidth<670&&hudHeight>hudWidth;
  const {style,classList}=document.body;
  style.setProperty('--game-height',viewHeight+'px');
  style.setProperty('--hud-width',hudWidth+'px');
  style.setProperty('--hud-height',hudHeight+'px');
  style.setProperty('--hud-scale',String(hudScale));
  classList.toggle('touch-hud',touchLayout);
  classList.toggle('hud-compact',touchLayout&&hudWidth<=365);
  classList.toggle('hud-short',touchLayout&&hudHeight<=460);
  classList.toggle('hud-very-short',touchLayout&&hudHeight<=360);
  classList.toggle('hud-landscape',touchLayout&&hudWidth>=540&&hudHeight<=500&&hudWidth>hudHeight);
  classList.toggle('portrait-intro',portraitIntro);
  camera.aspect=viewWidth/viewHeight;
  const combatFov=2*Math.atan(Math.tan(15*Math.PI/180)/camera.aspect)*180/Math.PI;
  camera.fov=cockpit?cockpitFov:mode==='intro'&&portraitIntro?65:mode==='combat'?Math.min(82,Math.max(57,combatFov)):57;
  camera.updateProjectionMatrix();
  if(cockpit)paintCockpit(el('cockpit-frame'),viewWidth,viewHeight,devicePixelRatio);
  effects.resize(viewWidth,viewHeight,devicePixelRatio);
  if(renderer){
    renderer.setPixelRatio(Math.min(devicePixelRatio,mobile?1.25:1.55));
    renderer.setSize(viewWidth,viewHeight);
  }else{lite.resize(viewWidth,viewHeight,devicePixelRatio);}
}
function throttleAvailable(available){
  power.tabIndex=available?0:-1;
  power.setAttribute('aria-disabled',String(!available));
}
function updateThrottle(){
  const value=Math.round(flight.throttle*100), text=value+'%';
  if(power.getAttribute('aria-valuetext')===text)return;
  power.setAttribute('aria-valuenow',String(value));
  power.setAttribute('aria-valuetext',text);
  power.style.setProperty('--power',text);
  el('percent').textContent=text;
}
function resetTouch(){
  weapons.gun=false;weapons.missile=false;weapons.gunTap=false;weapons.missileTap=false;
  const pointer=touch.id;
  updateStick(0,0,0);
  touch.id=null;touch.brake=false;touch.press=null;touch.lastTap=null;
  if(pointer!==null&&stick.hasPointerCapture?.(pointer))stick.releasePointerCapture(pointer);
}
function setCockpit(value){
  const changed=cockpit!==value;
  cockpit=value;
  if(changed&&loaded)resize();
  document.body.classList.toggle('cockpit',value);
  buttons.camera.title=value?'機外視点 (C)':'操縦席視点 (C)';
  buttons.camera.setAttribute('aria-pressed',String(value));
}
function begin(next){
  if(!loaded&&next!=='intro')return;
  keys.clear();resetTouch();setCockpit(false);elapsed=0;mode=next;maneuverNotice=null;
  const isCombat=next==='combat', canPilot=next==='manual'||isCombat;
  flight=isCombat?initialCombatFlight(initialFlight()):initialFlight();
  battle=isCombat?startCombat(flight):null;
  document.body.classList.toggle('playing',next!=='intro');
  document.body.classList.toggle('combat',isCombat);
  document.body.classList.toggle('piloting',canPilot);
  el('intro').hidden=next!=='intro';el('flight').hidden=next==='intro';
  el('combat-view').hidden=!isCombat;el('combat-info').hidden=!isCombat;el('weapons').hidden=!isCombat;
  buttons.camera.disabled=false;buttons.gun.disabled=false;buttons.missile.disabled=false;
  throttleAvailable(canPilot);stick.hidden=!canPilot;buttons.brake.hidden=next!=='manual';
  el('manual-help').hidden=next==='demo';
  el('manual-help').textContent=isCombat?'SPACE 機関銃　X ミサイル　矢印キー 操縦　W / S 推力':'W / S 推力　↑ 下降　↓ 上昇　← / → 旋回　SPACE ブレーキ';
  updateThrottle();lastHud=0;resize();
  el('map-title').textContent=isCombat?'RADAR / 1.5 KM':'COASTAL / 36';
  mapCanvas.setAttribute('aria-label',isCombat?'敵機の位置を表示するレーダー':'滑走路の位置と機首方位');
  if(next!=='intro')startAudio();
}
function radarFrame(){
  const center=72, scale=.0415, cos=Math.cos(flight.heading), sin=Math.sin(flight.heading);
  map.fillStyle='#14292f';map.fillRect(0,0,144,144);
  map.save();map.translate(center,center);
  map.strokeStyle='#78959080';map.lineWidth=1;
  for(const radius of [20,40,62]){map.beginPath();map.arc(0,0,radius,0,Math.PI*2);map.stroke();}
  map.beginPath();map.moveTo(0,0);map.lineTo(-25,-59);map.moveTo(0,0);map.lineTo(25,-59);map.stroke();
  map.fillStyle='#ffe0a3';map.beginPath();map.moveTo(0,-6);map.lineTo(4,5);map.lineTo(0,2.3);map.lineTo(-4,5);map.closePath();map.fill();
  for(const e of battle.enemies){
    if(e.hp<=0)continue;
    const dx=e.p.x-flight.x,dz=e.p.z-flight.z;
    const x=(dx*cos+dz*sin)*scale,z=(-dx*sin+dz*cos)*scale;
    const distance=Math.hypot(x,z), k=Math.min(1,61/Math.max(1,distance));
    map.fillStyle=battle.target===e.id?'#ffd88f':battle.guide===e?'#ffc3a3':'#ff8579';
    map.fillRect(x*k-2,z*k-2,4,4);
  }
  if(battle.incoming&&!battle.result){
    const p=battle.incoming.p,dx=p.x-flight.x,dz=p.z-flight.z;
    const x=(dx*cos+dz*sin)*scale,z=(-dx*sin+dz*cos)*scale;
    const k=Math.min(1,61/Math.max(1,Math.hypot(x,z)));
    map.strokeStyle='#ff6154';map.lineWidth=1.5;map.beginPath();
    map.moveTo(x*k,z*k-5);map.lineTo(x*k+5,z*k);map.lineTo(x*k,z*k+5);map.lineTo(x*k-5,z*k);
    map.closePath();map.stroke();
  }
  map.restore();
}
function mapFrame(){
  if(battle){radarFrame();return;}
  const size=144, center=72, scale=.0304;
  map.clearRect(0,0,size,size);
  map.fillStyle='#183444';map.fillRect(0,0,size,size);
  map.strokeStyle='#8ba4a42b';map.lineWidth=.7;
  for(let v=0;v<=size;v+=18){map.beginPath();map.moveTo(v,0);map.lineTo(v,size);map.moveTo(0,v);map.lineTo(size,v);map.stroke();}
  map.save();map.translate(center,center);
  map.beginPath();
  for(let i=0;i<=100;i++){
    const theta=i/100*Math.PI*2;
    const z=Math.sin(theta)*1700,x=150+Math.cos(theta)*990+145*Math.sin(z/550);
    if(i===0)map.moveTo(x*scale,z*scale);else map.lineTo(x*scale,z*scale);
  }
  map.closePath();map.fillStyle='#677655';map.fill();map.strokeStyle='#b3ad7e';map.stroke();
  map.strokeStyle='#f2d7a4';map.lineWidth=2;map.beginPath();map.moveTo(0,-runway.halfLength*scale);map.lineTo(0,runway.halfLength*scale);map.stroke();
  const x=clamp(flight.x*scale,-64,64),z=clamp(flight.z*scale,-64,64);
  map.translate(x,z);map.rotate(flight.heading);map.fillStyle='#ffda96';map.strokeStyle='#1b241e';map.lineWidth=1.25;
  map.beginPath();map.moveTo(0,-7);map.lineTo(5,5);map.lineTo(0,2.3);map.lineTo(-5,5);map.closePath();map.fill();map.stroke();map.restore();
  map.fillStyle='#e0d3b4';map.font='10px Helvetica';map.fillText('N',5,12);
}
function statusText(){
  if(battle?.result)return battle.result+'。「再開」で新しい作戦を開始。';
  if(battle?.incoming){
    const missile=battle.incoming;
    const range=Math.round(Math.hypot(missile.p.x-flight.x,missile.p.y-flight.y,missile.p.z-flight.z));
    const action=flight.maneuver?.action==='loop'?'ループ中':range>223?'もう少し引きつける':range>94?'今すぐ ↓ を2回タップ':'至近距離';
    return '⚠ ミサイル '+range+' m｜'+action;
  }
  if(battle?.evadeTime>0)return 'ミサイル回避｜追尾を振り切りました';
  if(flight.maneuver)return maneuverLabel(flight.maneuver.action)+'中';
  if(flight.phase==='air'&&!battle?.result&&maneuverNotice&&performance.now()<maneuverNotice.until)return maneuverNotice.text;
  if(battle){
    if(battle.enemies.every(e=>e.hp===0))return 'ウェーブクリア';
    if(battle.gunAssist&&battle.target===null)return '機銃補助｜機関銃を押し続けて射撃';
    if(battle.threat)return '後方に敵機｜旋回して射線から外れてください';
    if(battle.noticeTime>0)return battle.notice;
    if(flight.speed<55)return '速度低下｜推力を上げてください';
    if(battle.target!==null)return battle.ammo>0?'ロックオン｜ミサイル発射可能':'ミサイル残弾なし｜機関銃で迎撃';
    if(battle.tracking!==null)return '捕捉中｜敵機を照準内に維持';
    const enemy=battle.guide;
    if(enemy){
      const x=enemy.p.x-flight.x,y=enemy.p.y-flight.y,z=enemy.p.z-flight.z;
      const azimuth=Math.atan2(x,-z)-flight.heading;
      const bearing=Math.atan2(Math.sin(azimuth),Math.cos(azimuth));
      const range=Math.round(Math.hypot(x,y,z));
      const elevation=Math.atan2(y,Math.hypot(x,z))-flight.pitch;
      if(Math.abs(bearing)>.24){
        const side=bearing<0?'左':'右', region=Math.abs(bearing)>Math.PI*.5?'後方':'前方';
        return '敵機 '+side+region+' '+range+' m｜'+side+'へ旋回';
      }
      if(Math.abs(elevation)>.18)return '敵機 '+(elevation>0?'上方':'下方')+' '+range+' m｜機首を'+(elevation>0?'上げる':'下げる');
      return '敵機 正面 '+range+' m｜丸印を狙って射撃';
    }
    return 'レーダーで敵機の位置を確認';
  }
  if(flight.phase==='crashed')return '機体が地面に接触しました。「再開」で滑走路に戻れます。';
  if(flight.phase==='complete')return mode==='demo'?'デモ飛行完了｜「終了」から手動操縦を選べます。':'着陸成功｜滑走路上に停止しました。';
  if(flight.phase==='landing')return mode==='demo'?'デモ飛行｜着陸・減速中':'接地しました。推力を絞ってブレーキ。';
  if(mode==='demo')return flight.phase==='ground'?'デモ飛行｜離陸滑走':'デモ飛行｜海岸を旋回して滑走路へ';
  if(flight.phase==='ground'){
    if(flight.speed<4)return '左下のスロットルを右へ動かして滑走開始';
    return flight.speed<35?'滑走中｜速度を上げる':'右下の「↓ 上昇」を押し続けて離陸';
  }
  const altitude=flight.y-rideHeight(flight)-runway.level;
  if(Math.abs(flight.x)<130&&Math.abs(flight.z)>450&&altitude<90)
    return '進入｜滑走路と方位を合わせ、推力を絞ってゆっくり降下';
  if(altitude<40&&flight.speed<41)return '速度低下｜推力を上げる';
  return '飛行中｜滑走路 36 / 18 どちらからでも進入できます';
}
function hud(time){
  if(time-lastHud<.12)return;
  lastHud=time;
  const height=Math.max(0,flight.y-rideHeight(flight)-heightAt(flight.x,flight.z));
  el('speed').textContent=String(Math.round(flight.speed*1.94384)).padStart(3,'0');
  el('status').classList.toggle('missile-alert',!!battle?.incoming&&!battle.result);
  el('gear-state').textContent=flight.gear>=.985?'GEAR DOWN':flight.gear<=.015?'GEAR UP':'GEAR MOVING';
  el('altitude').textContent=String(Math.round(height*3.28084)).padStart(4,'0');
  const degree=Math.round(flight.heading*180/Math.PI);
  el('heading').textContent=String((degree%360+360)%360).padStart(3,'0');
  const text=statusText();
  if(text!==lastText){el('status').textContent=text;lastText=text;}
  updateThrottle();
  if(battle){
    el('wave').textContent=battle.wave+' / 3';
    el('score').textContent=String(battle.score).padStart(4,'0');
    el('shield').textContent=battle.shield+'%';
    el('ammo').textContent=battle.ammo;
    buttons.missile.classList.toggle('locked',battle.target!==null&&battle.ammo>0);
    buttons.gun.classList.toggle('assisted',battle.gunAssist&&!battle.result);
  }
  mapFrame();
}
function controls(dt){
  if(battle?.destruction){advanceCombat(battle,flight,{},dt,heightAt);return;}
  if(keys.has('KeyW'))flight.throttle=clamp(flight.throttle+dt*.67,0,1);
  if(keys.has('KeyS'))flight.throttle=clamp(flight.throttle-dt*.67,0,1);
  const pitch=clamp(Number(keys.has('ArrowDown'))-Number(keys.has('ArrowUp'))+touch.y,-1,1);
  const roll=clamp(Number(keys.has('ArrowRight'))-Number(keys.has('ArrowLeft'))+touch.x,-1,1);
  const braking=mode==='manual'&&(keys.has('Space')||touch.brake);
  advance(flight,{pitch,roll,braking,combat:!!battle},dt,heightAt);
  if(battle){
    advanceCombat(battle,flight,{gun:keys.has('Space')||weapons.gun||weapons.gunTap,
      missile:keys.has('KeyX')||weapons.missile||weapons.missileTap},dt,heightAt);
    weapons.gunTap=false;weapons.missileTap=false;
    for(const event of battle.events){
      weaponAudio(event);
      if(event==='destroyed'){
        setCockpit(false);
        resetTouch();
        buttons.camera.disabled=true;buttons.gun.disabled=true;buttons.missile.disabled=true;throttleAvailable(false);
      }
    }
    battle.events.length=0;
  }
}
function visual(shadow,time,dt){
  const displayed=mode==='intro'?showcase:flight;
  const {x,y,z,heading,pitch,bank,phase}=displayed;
  const terrainHeight=heightAt(x,z);
  const lift=y-terrainHeight-rideHeight(displayed);
  modelPosition.set(x,y,z);
  airframe.position.copy(modelPosition);
  airframe.rotation.set(pitch,-heading,-bank,'YXZ');
  airframe.visible=!cockpit&&!battle?.destruction;
  hardware.update(displayed,time,dt);
  shadow.position.set(x+Math.min(28,lift*.21),terrainHeight+.11,z+Math.min(24,lift*.20));
  shadow.rotation.z=heading;shadow.material.opacity=clamp(1-lift/105,0,.77);
  headingRotation.setFromAxisAngle(yAxis,-heading);
  if(mode==='intro'){
    const angle=.52+.10*Math.sin(time*.24);
    const fitDistance=5.75/(Math.tan(camera.fov*Math.PI/360)*camera.aspect);
    const distance=portraitIntro?Math.max(16,fitDistance):11.6;
    eye.set(distance*Math.sin(angle),portraitIntro?distance*.25:4,-distance*Math.cos(angle)).applyQuaternion(headingRotation).add(modelPosition);
    focus.set(portraitIntro?.9:3.25,portraitIntro?-distance*.14:.42,.19).applyQuaternion(headingRotation).add(modelPosition);
    camera.position.copy(eye);camera.up.set(0,1,0);camera.lookAt(focus);
  }else if(cockpit){
    eye.set(...cockpitEye).applyQuaternion(airframe.quaternion).add(modelPosition);
    if(phase==='ground'||phase==='landing')eye.y+=Math.sin(time*31)*Math.min(.035,flight.speed*.0007);
    camera.position.copy(eye);camera.quaternion.copy(airframe.quaternion);
  }else{
    const grounded=phase==='ground'||phase==='landing'||phase==='complete';
    const chaseX=mode==='combat'&&camera.aspect<.8?1.55:grounded?2.8:4.8;
    const framingDistance=4.7/(Math.tan(camera.fov*Math.PI/360)*camera.aspect*.87);
    desired.set(chaseX,grounded?3.7:5.4,Math.max(grounded?13.5:15.6,framingDistance)).applyQuaternion(headingRotation).add(modelPosition);
    if(camera.position.distanceTo(desired)>29||battle?.destruction?.age<.08)camera.position.copy(desired);
    camera.position.lerp(desired,1-Math.exp(-5.6*dt));
    focus.set(0,grounded?.70:1.18,grounded?-9:-10.5).applyQuaternion(headingRotation).add(modelPosition);
    camera.up.set(0,1,0);camera.lookAt(focus);
  }
  if(renderer){renderWorld(camera,time);renderer.render(scene,camera);}
  else lite.render(camera,airframe,displayed,time);
  if(battle)effects.render(camera,flight,battle);
}
function updateStick(x,y,radius){
  touch.x=x;touch.y=y;
  stick.classList.toggle('active',x!==0||y!==0);
  stick.style.setProperty('--stick-x',x*radius+'px');
  stick.style.setProperty('--stick-y',y*radius+'px');
}
function steer(event){
  const rect=stick.getBoundingClientRect(), radius=rect.width*.28;
  if(radius<=0)return;
  const x=(event.clientX-rect.left-rect.width/2)/radius;
  const y=(event.clientY-rect.top-rect.height/2)/radius;
  const length=Math.hypot(x,y);
  // Small movements near the center stay neutral; the labeled rim gives full input.
  const strength=clamp((length-.09)/.91,0,1);
  updateStick(length?x/length*strength:0,length?y/length*strength:0,stick.clientWidth*.28);
}
function tapDirection(event){
  const rect=stick.getBoundingClientRect();
  const x=event.clientX-rect.left-rect.width*.5,y=event.clientY-rect.top-rect.height*.5;
  if(Math.max(Math.abs(x),Math.abs(y))<rect.width*.18)return null;
  if(Math.abs(x)>Math.abs(y))return x<0?'left':'right';
  return y>0?'loop':null;
}
function maneuverLabel(action){
  return {loop:'ループ',left:'左ロール',right:'右ロール'}[action];
}
function triggerManeuver(action){
  if(!action||flight.phase!=='air'||flight.maneuver||battle?.result)return;
  if(startManeuver(flight,action,heightAt)){
    maneuverNotice={text:maneuverLabel(action)+'完了',until:performance.now()+(action==='loop'?6400:2800)};
  }else{
    maneuverNotice={text:action==='loop'?'ループには速度と高度が必要です':'ロールには高度が必要です',
      until:performance.now()+1800};
  }
}
function releaseStick(event){
  if(event.pointerId!==touch.id)return;
  const press=touch.press;
  touch.id=null;touch.press=null;
  updateStick(0,0,0);
  const tap=event.type==='pointerup'&&press?.direction&&!press.dragged
    &&event.timeStamp-press.time<=240&&Math.hypot(event.clientX-press.x,event.clientY-press.y)<=12;
  const previous=touch.lastTap;
  touch.lastTap=tap?{direction:press.direction,time:event.timeStamp}:null;
  if(!tap||previous?.direction!==press.direction||event.timeStamp-previous.time>410)return;
  touch.lastTap=null;
  triggerManeuver(press.direction);
}
function buttonEvents(){
  buttons.combat.onclick=()=>begin('combat');buttons.start.onclick=()=>begin('manual');buttons.demo.onclick=()=>begin('demo');
  buttons.camera.onclick=()=>{if(!battle?.destruction)setCockpit(!cockpit);};buttons.reset.onclick=()=>begin(mode);buttons.home.onclick=()=>begin('intro');
  const track=power.querySelector('.power-track');
  let throttlePointer=null;
  function dragThrottle(event){
    const {left,width}=track.getBoundingClientRect();
    flight.throttle=clamp((event.clientX-left)/width,0,1);
    updateThrottle();
  }
  power.addEventListener('pointerdown',event=>{
    if(event.button!==0||power.tabIndex<0||throttlePointer!==null)return;
    event.preventDefault();
    throttlePointer=event.pointerId;
    power.setPointerCapture(event.pointerId);
    dragThrottle(event);
  });
  power.addEventListener('pointermove',event=>{
    if(power.tabIndex>=0&&event.pointerId===throttlePointer)dragThrottle(event);
  });
  power.addEventListener('lostpointercapture',event=>{
    if(event.pointerId===throttlePointer)throttlePointer=null;
  });
  power.addEventListener('keydown',event=>{
    if(power.tabIndex<0)return;
    const adjustments={ArrowLeft:-.05,ArrowDown:-.05,ArrowRight:.05,ArrowUp:.05,PageDown:-.1,PageUp:.1};
    const delta=adjustments[event.code];
    if(delta===undefined&&event.code!=='Home'&&event.code!=='End')return;
    event.preventDefault();
    event.stopPropagation();
    flight.throttle=delta!==undefined?clamp(flight.throttle+delta,0,1):Number(event.code==='End');
    updateThrottle();
  });
  window.addEventListener('keydown',event=>{
    if(mode==='intro')return;
    if(event.target instanceof HTMLButtonElement&&event.code==='Space'&&mode!=='combat')return;
    if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','KeyW','KeyS','KeyX'].includes(event.code)){event.preventDefault();keys.add(event.code);}
    if(event.repeat)return;
    if(event.code==='KeyC'&&!battle?.destruction)setCockpit(!cockpit);
    if(event.code==='KeyR')begin(mode);
    if(event.code==='Escape')begin('intro');
  });
  window.addEventListener('keyup',event=>keys.delete(event.code));
  window.addEventListener('blur',()=>{keys.clear();resetTouch();});
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){keys.clear();resetTouch();}
  });
  stick.addEventListener('contextmenu',event=>event.preventDefault());
  stick.addEventListener('pointerdown',event=>{
    if((mode!=='manual'&&mode!=='combat')||touch.id!==null||event.button!==0)return;
    event.preventDefault();
    touch.id=event.pointerId;
    touch.press={direction:tapDirection(event),x:event.clientX,y:event.clientY,time:event.timeStamp,dragged:false};
    steer(event);
    // Window listeners also cover embedded browsers where capture is unavailable.
    try{stick.setPointerCapture?.(event.pointerId);}catch(error){
      if(error.name!=='NotFoundError')throw error;
    }
  });
  window.addEventListener('pointermove',event=>{
    if(event.pointerId!==touch.id)return;
    if(Math.hypot(event.clientX-touch.press.x,event.clientY-touch.press.y)>12)touch.press.dragged=true;
    steer(event);
  });
  window.addEventListener('pointerup',releaseStick);
  window.addEventListener('pointercancel',releaseStick);
  stick.addEventListener('lostpointercapture',releaseStick);
  stick.addEventListener('dblclick',event=>{
    if(event.sourceCapabilities?.firesTouchEvents)return;
    touch.lastTap=null;
    triggerManeuver(tapDirection(event));
  });
  for(const name of ['gun','missile']){
    const button=buttons[name];
    button.onpointerdown=event=>{
      weapons[name]=true;weapons[name+'Tap']=true;button.setPointerCapture(event.pointerId);
    };
    button.onpointerup=button.onpointercancel=button.onlostpointercapture=()=>{weapons[name]=false;};
    button.onclick=event=>{if(event.detail===0)weapons[name+'Tap']=true;};
  }
  buttons.brake.onpointerdown=event=>{touch.brake=true;buttons.brake.setPointerCapture(event.pointerId);};
  buttons.brake.onpointerup=buttons.brake.onpointercancel=buttons.brake.onlostpointercapture=()=>{touch.brake=false;};
}
async function setup(){
  const canvas=document.createElement('canvas');
  const context=canvas.getContext('webgl2',{antialias:true,powerPreference:'high-performance'});
  if(context){
    renderer=new T.WebGLRenderer({canvas,context,antialias:true});
    renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.03;
    el('view').append(canvas);
    renderWorld=createWorld(scene,renderer);
    scene.add(airframe);
  }else{
    lite=await createLite(hardware.group);
    el('view').append(lite.canvas);
    el('display-mode').textContent='LIGHT DISPLAY';
  }
  const shadow=addShadow();
  resize();window.addEventListener('resize',resize);
  window.visualViewport?.addEventListener('resize',resize);
  buttonEvents();
  if(renderer){
    const [model,occlusion]=await Promise.all([
      new GLTFLoader().loadAsync('./models/personal-jet-stl.glb'),
      loadJetOcclusion('./models/jet-surface-ao.bin')
    ]);
    const finish=jetFinishMaterial();
    model.scene.traverse(object=>{
      if(!object.isMesh)return;
      if(object.geometry.attributes.position.count!==occlusion.length)throw Error('Airframe shading does not match the model');
      object.geometry.setAttribute('jetOcclusion',new T.Uint8BufferAttribute(occlusion,1,true));
      object.material=finish;
    });
    airframe.add(model.scene);
  }
  let last=performance.now(), accumulator=0;
  function tick(milliseconds){
    const time=milliseconds/1000, dt=clamp((milliseconds-last)/1000,0,.25);last=milliseconds;
    if(mode==='demo'){
      elapsed=Math.min(demoDuration,elapsed+dt);flight=demoFlight(elapsed);
    }else if(mode==='manual'||mode==='combat'){
      accumulator+=dt;
      while(accumulator>=1/90){controls(1/90);accumulator-=1/90;}
    }
    if(mode!=='intro')hud(time);
    audioFrame();
    visual(shadow,time,dt||.016);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  loaded=true;buttons.combat.disabled=false;buttons.start.disabled=false;buttons.demo.disabled=false;el('load').textContent='';
}
setup().catch(error=>{
  console.error(error);
  el('load').textContent='ゲームを読み込めませんでした。ページを再読み込みしてください。';
});
