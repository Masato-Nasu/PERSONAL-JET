import {gunMuzzles} from './gun-mounts.js';

const FINAL_WAVE=3;
const MAX_MISSILES=4;
export const missileLength=2.75;
const LOCK_TIME=.44;
const RAD=Math.PI/180;
const GUN_ASSIST_CONE=Math.cos(11*RAD);
const GUN_ASSIST_RANGE=520;
const vec=(x=0,y=0,z=0)=>({x,y,z});
const add=(a,b,k=1)=>vec(a.x+b.x*k,a.y+b.y*k,a.z+b.z*k);
const sub=(a,b)=>add(a,b,-1);
const size=a=>Math.hypot(a.x,a.y,a.z);
const normal=a=>{const m=size(a)||1;return vec(a.x/m,a.y/m,a.z/m);};
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const approach=(value,target,rate,dt)=>value+(target-value)*(1-Math.exp(-rate*dt));
const angleDelta=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
const forward=f=>vec(Math.sin(f.heading)*Math.cos(f.pitch),Math.sin(f.pitch),-Math.cos(f.heading)*Math.cos(f.pitch));
const right=f=>vec(Math.cos(f.heading),0,Math.sin(f.heading));
const position=f=>vec(f.x,f.y,f.z);
const scaled=(a,k)=>vec(a.x*k,a.y*k,a.z*k);

export function initialCombatFlight(initial){
  return {...initial,x:-650,y:295,z:440,heading:-.48,speed:92,throttle:.72,phase:'air',hasFlown:true,gear:0,departure:false};
}
function addWave(state,f){
  const count=state.wave+1, dir=forward(f), across=right(f), center=position(f);
  state.enemies=Array.from({length:count},(_,i)=>{
    const side=i%2===0?-1:1;
    // Keep the first contact visible. A second drone starts outside the player's forward view.
    const rear=i===count-1;
    const lateral=rear?54+state.wave*7:(i-(count-2)*.5)*62;
    const distance=rear?-240-state.wave*18:245+i*45;
    const p=add(add(center,dir,distance),across,lateral);
    p.y=Math.max(140,p.y+(i%3-1)*13+7);
    const heading=f.heading+(rear?-.095:side*.045);
    const e={id:state.wave*10+i,p,last:p,heading,pitch:0,bank:0,speed:clamp(f.speed-14+i*2,68,102),
      hp:3+state.wave,maxHP:3+state.wave,shoot:.6+i*.4,phase:rear?'pursuit':'opening',hold:rear?1.6:4.7-state.wave*.22+i*.55,side,flash:0,breakWait:0,turnTime:0,
      launch:rear?1.6:2.7+i*.8};
    e.velocity=scaled(forward(e),e.speed);
    return e;
  });
  state.guide=state.enemies[0];
}
export function startCombat(f){
  const state={wave:1,score:0,shield:100,ammo:MAX_MISSILES,elapsed:0,gunSide:0,gunWait:0,missileWait:0,
    pause:0,flash:0,contact:null,target:null,tracking:null,lock:0,lead:null,gunAssist:false,gunImpact:null,threat:false,incoming:null,hostileWait:1.5,evadeTime:0,destruction:null,result:null,
    last:position(f),enemies:[],shots:[],bursts:[],smoke:[],events:[]};
  addWave(state,f);return state;
}
function findContact(origin,dir,enemies,angle,maxRange,minRange=0){
  const threshold=Math.cos(angle*RAD);
  let best=null,bestCost=Infinity;
  for(const e of enemies){
    if(e.hp<=0)continue;
    const offset=sub(e.p,origin),range=size(offset),align=dot(dir,normal(offset));
    const cost=(1-align)*900+range*.25;
    if(align>=threshold&&range<=maxRange&&range>=minRange&&cost<bestCost){best=e;bestCost=cost;}
  }
  return best;
}
function intercept(origin,target,velocity,speed){
  const offset=sub(target,origin);
  const a=speed*speed-dot(velocity,velocity), b=dot(offset,velocity), c=dot(offset,offset);
  const time=a>0?clamp((b+Math.sqrt(b*b+a*c))/a,0,3):Math.min(3,Math.sqrt(c)/speed);
  return add(target,velocity,time);
}
function shot(kind,origin,direction,velocity,life){
  return {kind,p:origin,last:origin,dir:direction,speed:velocity,life};
}
function hitSegment(point,previous,from,to,radius){
  const a=sub(from,previous), b=sub(to,point), delta=sub(b,a);
  const t=clamp(-dot(a,delta)/(dot(delta,delta)||1),0,1);
  return size(add(a,delta,t))<=radius;
}
function damage(state,enemy,amount){
  enemy.hp=Math.max(0,enemy.hp-amount);enemy.flash=.14;
  if(enemy.hp===0){
    state.score+=state.wave*150;state.bursts.push({p:enemy.p,life:.80,total:.80});
    state.events.push('burst');
  }
}
function turnToward(direction,target,maximum){
  const cosine=clamp(dot(direction,target),-1,1), angle=Math.acos(cosine);
  if(angle<=maximum)return target;
  const tangent=normal(add(target,direction,-cosine));
  if(size(tangent)<.5)return direction;
  return normal(add(scaled(direction,Math.cos(maximum)),tangent,Math.sin(maximum)));
}

function flyEnemy(state,e,player,dt,groundAt){
  e.last=e.p;e.flash=Math.max(0,e.flash-dt);e.shoot-=dt;e.hold-=dt;e.breakWait-=dt;e.launch-=dt;
  const offset=sub(player.p,e.p), distance=size(offset), facing=dot(forward(e),normal(offset));
  e.turnTime=e.phase==='pursuit'&&Math.abs(e.bank)>.73&&distance<620?e.turnTime+dt:0;
  const missile=state.shots.find(s=>s.kind==='missile'&&s.target===e.id&&size(sub(s.p,e.p))<285);
  if(missile&&e.breakWait<=0&&e.phase!=='break'){
    const from=sub(missile.p,e.p);
    e.side=dot(from,right(e))>0?-1:1;
    e.phase='break';e.hold=2.3;e.breakWait=5;
  }else if(e.hold<=0){
    if(e.phase==='break'||e.phase==='extend'||e.phase==='opening'){e.phase='pursuit';}
    else if(e.turnTime>4.8||(distance<125&&facing<.4)){
      e.phase='extend';e.hold=1.9+state.wave*.18;e.turnTime=0;
    }
    else if(e.phase==='intercept'&&distance<360){e.phase='pursuit';}
  }
  const eDir=forward(e);
  const ahead=add(e.p,eDir,260);
  const floor=groundAt(ahead.x,ahead.z)+105;
  let desiredHeading=e.heading, desiredPitch=0, desiredSpeed=109+state.wave*4;
  if(e.phase==='opening'){
    desiredSpeed=e.speed;
  }else if(e.phase==='break'){
    desiredHeading+=e.side*1.2;
    desiredPitch=e.p.y>floor+75?-.18:.23;
    desiredSpeed=121;
  }else if(e.phase!=='extend'){
    const leadTime=clamp(distance/(e.speed+player.speed*.65),.18,2);
    const aim=add(player.p,player.velocity,leadTime);
    const delta=sub(aim,e.p);
    desiredHeading=Math.atan2(delta.x,-delta.z);
    desiredPitch=clamp(Math.atan2(delta.y,Math.hypot(delta.x,delta.z)),-.43,.43);
    if(facing>.76&&distance<350)desiredSpeed=clamp(player.speed+(distance-160)*.17,65,119);
    if(distance>600&&facing>.45)desiredSpeed=clamp(player.speed+30,112,150);
  }
  if(e.p.y<floor)desiredPitch=Math.max(desiredPitch,.28);
  const headingError=angleDelta(desiredHeading,e.heading);
  const targetBank=clamp(headingError*1.85,-1.13,1.13);
  e.bank=approach(e.bank,targetBank,2.6,dt);
  e.heading+=Math.tan(e.bank)*(14.1+state.wave*.65)/Math.max(62,e.speed)*dt;
  e.pitch=approach(e.pitch,desiredPitch,1.95,dt);
  e.speed=approach(e.speed,desiredSpeed-Math.abs(e.bank)*9,.55,dt);
  e.velocity=scaled(forward(e),e.speed);
  e.p=add(e.p,e.velocity,dt);

  const range=size(sub(player.p,e.p));
  const muzzle=add(e.p,forward(e),2.8);
  const predicted=intercept(muzzle,player.p,player.velocity,340+e.speed);
  const aim=normal(sub(predicted,muzzle));
  const firingAngle=dot(forward(e),aim);
  if(range<480&&range>42&&firingAngle>Math.cos(7*RAD)&&e.shoot<=0&&e.phase!=='break'){
    e.shoot=1.16+(.23*Math.sin(e.id+state.elapsed));
    const deviation=.014*Math.sin(e.id+state.elapsed*3.1);
    state.shots.push(shot('enemy',muzzle,normal(add(aim,right(e),deviation)),340+e.speed,1.9));
  }
  if(range>190&&range<620&&facing>Math.cos(25*RAD)&&e.launch<=0&&state.hostileWait<=0&&e.phase==='pursuit'
    &&!state.shots.some(s=>s.kind==='enemyMissile'&&s.guiding)){
    const missile=shot('enemyMissile',muzzle,forward(e),e.speed+19,6.2);
    Object.assign(missile,{age:0,lost:0,smokeWait:0,guiding:true});
    state.shots.push(missile);
    state.events.push('warning');
    e.launch=9-state.wave*.85;
    state.hostileWait=6.8-state.wave*.65;
  }
  return range<560&&range>32&&dot(player.dir,normal(sub(e.p,player.p)))<-.48&&firingAngle>.87;
}
function flyMissile(state,s,dt){
  s.age+=dt;
  if(s.age<.19){
    s.p=add(add(s.p,s.dir,s.speed*dt),vec(0,-1,0),dt*(1+s.age*13));
    missileSmoke(state,s,dt);
    return;
  }
  const target=state.enemies.find(e=>e.id===s.target&&e.hp>0);
  s.speed=Math.min(345,s.speed+(s.age<2.15?119:16)*dt);
  if(target){
    const aim=normal(sub(intercept(s.p,target.p,target.velocity,s.speed),s.p));
    const line=normal(sub(target.p,s.p));
    s.lost=dot(s.dir,line)<Math.cos(63*RAD)?s.lost+dt:0;
    if(s.lost>.22){s.target=null;state.notice='ミサイル追尾喪失';state.noticeTime=1.45;}
    else s.dir=turnToward(s.dir,aim,(s.speed<220?1.6:1.21)*dt);
  }
  s.p=add(s.p,s.dir,s.speed*dt);
  missileSmoke(state,s,dt);
}
function missileSmoke(state,s,dt){
  const ignition=clamp((s.age-.17)/.16,0,1);
  const burnout=clamp((s.age-2.15)/.75,0,1);
  s.exhaust=.25+.75*ignition*(1-burnout);
  s.smokeWait-=dt;
  if(s.smokeWait<=0){
    s.smokeWait=.036;
    const puff=add(s.p,s.dir,-missileLength);
    state.smoke.push({p:puff,from:s.lastSmoke,life:1.55,exhaust:s.exhaust});
    s.lastSmoke=puff;
  }
}
function flyHostile(state,s,player,dt){
  s.age+=dt;
  s.speed=Math.min(256,s.speed+(s.age<2?110:24)*dt);
  if(s.guiding){
    const offset=sub(player.p,s.p), distance=size(offset), line=normal(offset);
    const lead=clamp(distance/s.speed*.56,0,.85);
    const aim=normal(add(offset,player.velocity,lead));
    const canTrack=dot(s.dir,line)>Math.cos(39*RAD);
    s.lost=canTrack?0:s.lost+dt;
    if(s.lost>.21){
      s.guiding=false;
      state.evadeTime=2.15;
    }else if(s.age>.14){
      // Limit steering authority. High crossing rates can put the target outside the seeker cone.
      s.dir=turnToward(s.dir,aim,(s.speed>215?.36:.63)*dt);
    }
  }
  s.p=add(s.p,s.dir,s.speed*dt);
  missileSmoke(state,s,dt);
}
export function advanceCombat(state,f,input,dt,groundAt=()=>0){
  if(state.result){
    if(state.destruction)state.destruction.age+=dt;
    return;
  }
  if(f.phase!=='air'){state.result='失敗｜機体が飛行を続けられなくなりました';return;}
  state.elapsed+=dt;state.gunWait-=dt;state.missileWait-=dt;state.hostileWait-=dt;
  state.evadeTime=Math.max(0,state.evadeTime-dt);
  if(state.gunImpact&&(state.gunImpact.life-=dt)<=0)state.gunImpact=null;
  state.flash=Math.max(0,state.flash-dt);state.noticeTime=Math.max(0,(state.noticeTime??0)-dt);
  const origin=position(f), dir=forward(f), across=right(f);
  const player={p:origin,dir,velocity:scaled(dir,f.speed),speed:f.speed};
  const candidate=findContact(origin,dir,state.enemies,22,1100,95);
  state.tracking=candidate?.id??null;
  if(state.tracking!==state.contact){state.contact=state.tracking;state.lock=0;}
  if(candidate)state.lock=Math.min(1,state.lock+dt/LOCK_TIME);
  state.target=state.lock>=1?state.tracking:null;
  const gunTarget=findContact(origin,dir,state.enemies,36,680);
  const gunSpeed=430+f.speed;
  state.lead=gunTarget?intercept(origin,gunTarget.p,gunTarget.velocity,gunSpeed):null;
  const leadOffset=state.lead&&sub(state.lead,origin);
  state.gunAssist=!!leadOffset&&size(leadOffset)<=GUN_ASSIST_RANGE&&dot(dir,normal(leadOffset))>=GUN_ASSIST_CONE;

  if(input.gun&&state.gunWait<=0){
    state.gunWait=.081;
    const [x,y,z]=gunMuzzles[state.gunSide];
    state.gunSide=1-state.gunSide;
    const sin=Math.sin(f.bank),cos=Math.cos(f.bank);
    const up=vec(-Math.sin(f.heading)*Math.sin(f.pitch),Math.cos(f.pitch),Math.cos(f.heading)*Math.sin(f.pitch));
    const muzzle=add(add(add(origin,dir,-z),across,x*cos+y*sin),up,y*cos-x*sin);
    // Correct the initial aim only. The rounds continue on a straight trajectory.
    const aim=state.gunAssist?normal(sub(state.lead,muzzle)):dir;
    state.shots.push(shot('gun',muzzle,aim,gunSpeed,1.65));
    state.events.push('gun');
  }
  if(input.missile&&state.missileWait<=0&&state.ammo>0&&state.target!==null){
    state.missileWait=.94;state.ammo--;
    const side=state.ammo%2===0?1:-1;
    const rail=add(add(add(origin,dir,.42),across,side*1.42),vec(0,-.32,0));
    const missile=shot('missile',rail,dir,f.speed+4,6);
    Object.assign(missile,{target:state.target,age:0,lost:0,smokeWait:0});
    state.shots.push(missile);
    state.events.push('missile');
  }

  state.threat=false;
  for(const e of state.enemies){
    if(e.hp>0&&flyEnemy(state,e,player,dt,groundAt))state.threat=true;
  }
  for(const s of state.shots){
    s.life-=dt;s.last=s.p;
    const hostile=s.kind==='enemyMissile', missile=hostile||s.kind==='missile';
    if(hostile)flyHostile(state,s,player,dt);
    else if(missile)flyMissile(state,s,dt);
    else s.p=add(s.p,s.dir,s.speed*dt);
    if(s.kind==='enemy'||hostile){
      if(hitSegment(origin,state.last,s.last,s.p,hostile?7:3.1)){
        s.life=0;state.shield=Math.max(0,state.shield-(hostile?42:18));state.flash=hostile?.57:.32;
        if(hostile)state.bursts.push({p:s.p,life:.58,total:.58});
        state.evadeTime=0;state.events.push('hit');continue;
      }
    }else{
      const hit=state.enemies.find(e=>e.hp>0&&hitSegment(e.p,e.last,s.last,s.p,missile?9:5.2));
      if(hit){
        if(!missile)state.gunImpact={p:hit.p,life:.21};
        s.life=0;damage(state,hit,missile?8:1);continue;
      }
    }
    if(missile){
      const ground=groundAt(s.p.x,s.p.z), grounded=s.p.y<=ground;
      if(grounded||s.life<=0){
        s.life=0;
        const end=grounded?{...s.p,y:ground}:s.p;
        state.bursts.push({p:end,life:.62,total:.62});
        if(hostile&&grounded&&s.guiding)state.evadeTime=2.15;
      }
    }
  }
  if(state.guide?.hp===0){
    state.guide=state.enemies.reduce((closest,e)=>e.hp>0&&(!closest||size(sub(e.p,origin))<size(sub(closest.p,origin)))?e:closest,null);
  }
  state.last=origin;
  state.shots=state.shots.filter(s=>s.life>0);
  const trackedMissile=state.shots.find(s=>s.kind==='enemyMissile'&&s.guiding)??null;
  state.incoming=trackedMissile;
  state.smoke=state.smoke.filter(s=>(s.life-=dt)>0);
  state.bursts=state.bursts.filter(b=>(b.life-=dt)>0);
  if(state.shield<=0){
    state.destruction={p:origin,dir,age:0};
    state.result='撃墜｜自機が爆発しました';
    state.incoming=null;state.target=null;state.gunAssist=false;
    state.shots=[];state.smoke=[];state.bursts=[];
    state.events.push('destroyed');
    return;
  }
  if(state.enemies.every(e=>e.hp===0)){
    state.pause+=dt;state.target=null;state.lead=null;state.gunAssist=false;
    if(state.pause>=2.2){
      if(state.wave===FINAL_WAVE){state.result='作戦完了｜すべてのドローンを撃墜';return;}
      state.wave++;state.pause=0;state.ammo=MAX_MISSILES;state.shield=Math.min(100,state.shield+12);addWave(state,f);
    }
  }
}
