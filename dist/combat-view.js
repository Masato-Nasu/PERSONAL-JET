import * as T from 'three';
import {missileLength} from './combat.js?v=missile-trail';
const projected=new T.Vector3(), relative=new T.Vector3(), direction=new T.Vector3();
const attitude=new T.Euler(0,0,0,'YXZ'), offset=new T.Vector3();
const blastFragments=Array.from({length:27},(_,i)=>{
  const azimuth=i*2.399963, y=1-2*(i+.5)/27, horizontal=Math.sqrt(1-y*y);
  const speed=12+(i*19%17)*1.65;
  return {x:Math.cos(azimuth)*horizontal*speed,y:y*speed,z:Math.sin(azimuth)*horizontal*speed,
    life:.72+(i*13%21)*.065};
});
const aircraftVertices=[
  [0,.04,-5],[-.88,-.25,-1.3],[.88,-.25,-1.3],[-.8,0,3.6],[.8,0,3.6],[0,.71,-.95],[0,.58,2.65],
  [-4.35,.03,1.65],[4.35,.03,1.65],[-3.62,0,2.9],[3.62,0,2.9],
  [-1.06,.04,2.26],[1.06,.04,2.26],[-1.24,1.33,2.65],[1.24,1.33,2.65],
  [-1.38,1.45,3.34],[1.38,1.45,3.34],[-1.05,.04,3.6],[1.05,.04,3.6]
];
const aircraftPanels=[
  [[0,1,5],'#5c6771'],[[0,5,2],'#8b9698'],[[0,2,1],'#303940'],
  [[1,3,6,5],'#5e686c'],[[2,5,6,4],'#a1a6a1'],[[1,2,4,3],'#384449'],[[3,4,6],'#445053'],
  [[1,7,9,3],'#758183'],[[2,4,10,8],'#8e9999'],[[11,13,15,17],'#8c9999'],[[12,14,16,18],'#66777d'],
  [[0,5,6],'#465963']
];
export function combatView(canvas){
  const ctx=canvas.getContext('2d');let w=1,h=1,focal=1,camera;
  function resize(width,height,dpr){
    const ratio=Math.min(dpr,1.35);w=width;h=height;
    canvas.width=Math.round(w*ratio);canvas.height=Math.round(h*ratio);ctx.setTransform(ratio,0,0,ratio,0,0);
  }
  function point(p){
    const depth=relative.set(p.x-camera.position.x,p.y-camera.position.y,p.z-camera.position.z).dot(direction);
    if(depth<=.2)return null;
    projected.set(p.x,p.y,p.z).project(camera);
    return {x:(projected.x+1)*w*.5,y:(1-projected.y)*h*.5,depth};
  }
  function stroke(points,color,weight){
    ctx.strokeStyle=color;ctx.lineWidth=weight;ctx.beginPath();ctx.moveTo(...points[0]);
    for(let i=1;i<points.length;i++)ctx.lineTo(...points[i]);
    ctx.stroke();
  }
  function polygon(points,fill){
    ctx.fillStyle=fill;ctx.beginPath();ctx.moveTo(...points[0]);
    for(let i=1;i<points.length;i++)ctx.lineTo(...points[i]);
    ctx.closePath();ctx.fill();
  }
  function drone(d,p,locked,tracking,guided,range,lock){
    const r=Math.min(39,Math.max(5,4.7*focal/p.depth)),x=p.x,y=p.y;
    if(x<-45||x>w+45||y<-45||y>h+45)return;
    attitude.set(d.pitch,-d.heading,-d.bank,'YXZ');
    const vertices=aircraftVertices.map(([vx,vy,vz])=>{
      offset.set(vx,vy,vz).applyEuler(attitude);
      return point({x:d.p.x+offset.x,y:d.p.y+offset.y,z:d.p.z+offset.z});
    });
    const panels=aircraftPanels.map(([indices,color])=>{
      const coords=indices.map(i=>vertices[i]);
      return coords.every(Boolean)?{coords,color,depth:coords.reduce((sum,q)=>sum+q.depth,0)/coords.length}:null;
    }).filter(Boolean).sort((a,b)=>b.depth-a.depth);
    for(const panel of panels)polygon(panel.coords.map(q=>[q.x,q.y]),d.flash?'#fff0cc':panel.color);
    const a=Math.max(guided?17:10,r+6), b=Math.max(guided?13:8,r*.60+6), k=6;
    const mark=locked?'#ffe4a5':guided||tracking?'#ffae8e':'#ed928a';
    ctx.save();ctx.translate(x,y);
    for(const i of [-1,1])for(const j of [-1,1])stroke([[i*(a-k),j*b],[i*a,j*b],[i*a,j*(b-k)]],mark,1);
    if(tracking||guided){
      ctx.fillStyle=mark;ctx.font='bold 11px Helvetica,sans-serif';ctx.textAlign='center';
      ctx.shadowColor='#0d1922';ctx.shadowBlur=5;
      ctx.fillText((locked?'LOCK':tracking?'捕捉中':'敵機')+'  '+Math.round(range)+' m',0,-b-6);
      ctx.shadowBlur=0;
      if(tracking&&!locked)stroke([[-a,b+3],[-a+a*2*lock,b+3]],mark,2);
    }
    ctx.restore();
  }
  function renderMissile(s){
    const end={x:s.p.x-s.dir.x*missileLength,y:s.p.y-s.dir.y*missileLength,z:s.p.z-s.dir.z*missileLength};
    const nose=point(s.p),tail=point(end),visible=nose??tail;
    if(!visible)return;
    const thickness=Math.min(9,Math.max(1.4,.22*focal/visible.depth));
    const dx=nose&&tail?nose.x-tail.x:0,dy=nose&&tail?nose.y-tail.y:0;
    const length=Math.hypot(dx,dy);
    ctx.save();
    ctx.lineCap='round';
    const plume=s.lastSmoke&&point(s.lastSmoke);
    if(tail&&plume){
      ctx.globalAlpha=.18+.42*s.exhaust;
      stroke([[plume.x,plume.y],[tail.x,tail.y]],'#f5ebdb',Math.max(1,thickness*.85));
      ctx.globalAlpha=1;
    }
    if(length>=2.4){
      const rx=-dy/length,ry=dx/length;
      const fin=Math.min(12,thickness*1.45);
      stroke([[tail.x,tail.y],[nose.x,nose.y]],'#454b50',thickness+1.25);
      polygon([[tail.x+rx*fin,tail.y+ry*fin],[tail.x+dx*.37,tail.y+dy*.37],[tail.x-rx*fin,tail.y-ry*fin]],'#a4acac');
      stroke([[tail.x,tail.y],[nose.x,nose.y]],'#e9e4d7',thickness);
      stroke([[tail.x+dx*.68,tail.y+dy*.68],[nose.x,nose.y]],'#a3a59f',Math.max(1,thickness*.55));
      ctx.globalAlpha=s.exhaust;
      const flame=Math.min(length*.8,31)/length;
      ctx.shadowBlur=7;ctx.shadowColor='#ffb06b';
      stroke([[tail.x-dx*flame,tail.y-dy*flame],[tail.x,tail.y]],'#ffac6a',thickness);
      stroke([[tail.x-dx*flame*.46,tail.y-dy*flame*.46],[tail.x,tail.y]],'#fff4d0',thickness*.64);
    }else{
      // The body can project to a point when viewed directly from the front or rear.
      const radius=Math.max(1.4,Math.min(3,thickness*.54));
      ctx.beginPath();ctx.arc(visible.x,visible.y,radius,0,Math.PI*2);
      ctx.strokeStyle='#454b50';ctx.lineWidth=1.2;ctx.stroke();
      ctx.fillStyle=s.exhaust>.5?'#fff1ca':'#e9e4d7';ctx.fill();
    }
    ctx.restore();
  }
  function renderSmoke(smoke){
    for(const puff of smoke){
      const p=point(puff.p);if(!p||p.x<-20||p.x>w+20||p.y<-20||p.y>h+20)continue;
      const age=1.55-puff.life, size=Math.min(25,Math.max(1.15,(.24+age*2.15)*focal/p.depth));
      const opacity=Math.min(.59,puff.life*.37)*(.36+.64*puff.exhaust);
      const previous=puff.from&&point(puff.from);
      if(previous){
        ctx.save();ctx.lineCap='round';
        stroke([[previous.x,previous.y],[p.x,p.y]],'rgba(239,232,215,'+opacity*.53+')',Math.max(.8,size*.88));
        ctx.restore();
      }
      const gradient=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,size);
      gradient.addColorStop(0,'rgba(245,239,224,'+opacity+')');
      gradient.addColorStop(.46,'rgba(235,229,214,'+opacity*.65+')');
      gradient.addColorStop(1,'rgba(228,222,209,0)');
      ctx.fillStyle=gradient;ctx.fillRect(p.x-size,p.y-size,size*2,size*2);
    }
  }
  function offscreen(flight,state){
    const nearest=state.guide;
    if(!nearest||state.result)return;
    const range=Math.hypot(nearest.p.x-flight.x,nearest.p.y-flight.y,nearest.p.z-flight.z);
    const projectedEnemy=point(nearest.p);
    if(projectedEnemy&&projectedEnemy.x>24&&projectedEnemy.x<w-24&&projectedEnemy.y>68&&projectedEnemy.y<h-64)return;
    const dx=nearest.p.x-flight.x,dz=nearest.p.z-flight.z,dy=nearest.p.y-flight.y;
    const bearing=Math.atan2(dx,-dz)-flight.heading, side=Math.sin(bearing), behind=Math.cos(bearing)<0;
    const horizontal=behind||!projectedEnemy?Math.sign(side)||1:(projectedEnemy.x-w*.5)/(w*.5);
    const vertical=behind?0:projectedEnemy?(projectedEnemy.y-h*.49)/(h*.49):-Math.sign(dy);
    const angle=Math.atan2(vertical,horizontal);
    const x=w*.5+Math.cos(angle)*w*.35, y=h*.48+Math.sin(angle)*h*.24;
    ctx.save();ctx.translate(x,y);ctx.rotate(angle);
    ctx.shadowColor='#11202c';ctx.shadowBlur=8;
    polygon([[11,0],[-7,-7],[-3,0],[-7,7]],'#ffc3a3');ctx.restore();
    ctx.save();ctx.fillStyle='#ffe3cc';ctx.font='bold 11px Helvetica,sans-serif';ctx.textAlign='center';
    ctx.shadowColor='#11202c';ctx.shadowBlur=5;
    ctx.fillText((behind?'後方 ':'敵機 ')+Math.round(range)+' m',x,y+19);
    ctx.restore();
  }
  function renderDestruction({p,dir,age}){
    if(age>3.6)return;
    function glow(at,radius,stops,opacity){
      const q=point(at);
      if(!q)return;
      const r=Math.min(Math.max(w,h)*.62,radius*focal/q.depth);
      if(r<.6)return;
      const gradient=ctx.createRadialGradient(q.x,q.y,0,q.x,q.y,r);
      for(const [stop,color] of stops)gradient.addColorStop(stop,color);
      ctx.globalAlpha=opacity;ctx.fillStyle=gradient;ctx.fillRect(q.x-r,q.y-r,2*r,2*r);
    }
    ctx.save();
    for(let i=0;i<8;i++){
      const t=age-i*.055;
      if(t<=0)continue;
      const drift=t*(1.7+(i%3)*.58);
      const cloud={x:p.x+Math.cos(i*2.4)*drift+dir.x*t*2.2,
        y:p.y+t*(2.2+i*.46),z:p.z+Math.sin(i*2.4)*drift+dir.z*t*2.2};
      glow(cloud,1.4+t*2.45,[[0,'#282625d4'],[.46,'#3433319e'],[1,'#403d3900']],
        Math.min(1,t*2.5)*Math.max(0,1-age/3.6));
    }
    if(age<.91){
      const fade=1-age/.91;
      for(let i=0;i<5;i++){
        const angle=i*2.4;
        const shift=age*(6+i*.9);
        const center={x:p.x+Math.cos(angle)*shift+dir.x*age*3,
          y:p.y+Math.sin(angle)*shift,z:p.z+Math.sin(angle)*shift*.73+dir.z*age*3};
        glow(center,2.2+age*11,[[0,'#fff6d4'],[.23,'#ffd276'],[.50,'#f5782dba'],
          [.72,'#b9361669'],[1,'#a6311100']],fade);
      }
    }
    for(const piece of blastFragments){
      if(age>=piece.life)continue;
      const at=t=>({x:p.x+(piece.x+dir.x*5)*t,y:p.y+piece.y*t-7*t*t,z:p.z+(piece.z+dir.z*5)*t});
      const front=point(at(age)),tail=point(at(Math.max(0,age-.065)));
      if(!front||!tail)continue;
      ctx.globalAlpha=Math.min(1,(piece.life-age)*2);
      stroke([[tail.x,tail.y],[front.x,front.y]],'#fda055',Math.max(.8,Math.min(3, .07*focal/front.depth)));
      ctx.fillStyle=age<.65?'#fff1ad':'#3d3431';
      const width=Math.max(1.3,Math.min(7,.105*focal/front.depth));
      ctx.fillRect(front.x-width*.5,front.y-width*.5,width,width);
    }
    ctx.restore();
  }
  function render(view,flight,state){
    ctx.clearRect(0,0,w,h);if(!state)return;
    camera=view;camera.updateMatrixWorld();camera.getWorldDirection(direction);
    focal=h*.5/Math.tan(camera.fov*Math.PI/360);
    if(state.destruction){
      const flash=Math.max(0,1-state.destruction.age/.26);
      if(flash){ctx.fillStyle='rgba(255,185,117,'+flash*.22+')';ctx.fillRect(0,0,w,h);}
      renderDestruction(state.destruction);
      return;
    }
    if(state.flash>0){ctx.fillStyle='rgba(195,39,21,'+state.flash*.38+')';ctx.fillRect(0,0,w,h);}
    renderSmoke(state.smoke);
    const enemies=state.enemies.filter(d=>d.hp>0).map(d=>[d,point(d.p)]).filter(([,p])=>p).sort((a,b)=>b[1].depth-a[1].depth);
    for(const [d,p] of enemies)drone(d,p,state.target===d.id,state.tracking===d.id,state.guide===d,
      Math.hypot(d.p.x-flight.x,d.p.y-flight.y,d.p.z-flight.z),state.lock);
    for(const s of state.shots){
      if(s.kind==='missile'||s.kind==='enemyMissile'){
        renderMissile(s);
        if(s===state.incoming){
          const p=point(s.p);
          if(p){
            const r=7;
            stroke([[p.x-r,p.y],[p.x,p.y-r],[p.x+r,p.y],[p.x,p.y+r],[p.x-r,p.y]],'#ff6355',1.5);
          }
        }
        continue;
      }
      const p=point(s.p),last=point(s.last);if(!p||!last)continue;
      const radius=s.kind==='enemy'?2:1.6;
      const dx=p.x-last.x,dy=p.y-last.y;
      const c=s.kind==='enemy'?'#ff7468':'#fff4b6';
      ctx.save();ctx.shadowColor=c;ctx.shadowBlur=7;
      stroke([[p.x-dx*2.5,p.y-dy*2.5],[p.x,p.y]],c,radius);
      ctx.fillStyle=c;ctx.beginPath();ctx.arc(p.x,p.y,radius*.61,0,Math.PI*2);ctx.fill();ctx.restore();
    }
    for(const b of state.bursts){
      const p=point(b.p);if(!p)continue;
      const t=1-b.life/b.total,r=Math.min(100,(2+t*12)*focal/p.depth);
      ctx.save();ctx.globalAlpha=1-t;
      const glow=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,r+1);
      glow.addColorStop(0,'#fff4c5');glow.addColorStop(.36,'#ffc674');glow.addColorStop(1,'#ef5b3100');
      ctx.fillStyle=glow;ctx.fillRect(p.x-r-1,p.y-r-1,2*r+2,2*r+2);
      for(let i=0;i<9;i++){
        const a=i*2.39,r2=r*(.63+.3*Math.sin(i*3));
        stroke([[p.x+Math.cos(a)*r2*.63,p.y+Math.sin(a)*r2*.63],[p.x+Math.cos(a)*r2,p.y+Math.sin(a)*r2]],'#ffe39b',1.3);
      }
      ctx.restore();
    }
    offscreen(flight,state);
    if(state.lead&&!state.result){
      const lead=point(state.lead);
      if(lead){
        const {x,y}=lead;
        ctx.save();ctx.shadowColor='#102520';ctx.shadowBlur=4;
        ctx.strokeStyle=state.gunAssist?'#95ffe1':'#d1f0e3';ctx.lineWidth=state.gunAssist?1.8:1;
        ctx.beginPath();ctx.arc(x,y,state.gunAssist?9:6,0,Math.PI*2);ctx.stroke();
        if(state.gunAssist){
          ctx.fillStyle='#dcfff2';ctx.beginPath();ctx.arc(x,y,1.5,0,Math.PI*2);ctx.fill();
        }
        ctx.restore();
      }
    }
    if(state.gunImpact&&!state.result){
      const impact=point(state.gunImpact.p);
      if(impact){
        const {x,y}=impact;
        ctx.save();ctx.globalAlpha=Math.min(1,state.gunImpact.life/.095);
        for(const i of [-1,1])for(const j of [-1,1]){
          stroke([[x+i*14,y+j*14],[x+i*7,y+j*7]],'#fff4bb',1.8);
        }
        ctx.restore();
      }
    }
    const range=state.lead?Math.hypot(state.lead.x-flight.x,state.lead.y-flight.y,state.lead.z-flight.z):300;
    const cos=Math.cos(flight.pitch);
    const sight=point({x:flight.x+Math.sin(flight.heading)*cos*range,y:flight.y+Math.sin(flight.pitch)*range,z:flight.z-Math.cos(flight.heading)*cos*range});
    if(sight&&!state.result){
      const {x,y}=sight,c=state.target===null?'#fff0d4b8':'#ffd48d';
      stroke([[x-17,y],[x-5,y]],c,1);stroke([[x+5,y],[x+17,y]],c,1);
      stroke([[x,y-13],[x,y-5]],c,1);stroke([[x,y+5],[x,y+13]],c,1);
    }
  }
  return {resize,render};
}
