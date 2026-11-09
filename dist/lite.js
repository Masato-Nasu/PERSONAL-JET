import * as T from 'three';
import {heightAt} from './world.js';
import {clamp} from './physics.js?v=counterfire';
import {makeJetStencil,sampleJetStencil,loadJetOcclusion} from './jet-finish.js?v=mirror-canopy';

const sun = new T.Vector3(-.67,.105,-.735).normalize();
const rgb=(r,g,b)=>'rgb('+Math.round(r)+','+Math.round(g)+','+Math.round(b)+')';
const palette={ground:[103,108,75], fog:[153,150,137]};
function lit(base, amount, haze=0){
  return rgb(...base.map((channel,index)=>channel*amount*(1-haze)+palette.fog[index]*haze));
}
function triangle(a,b,c,color){return {points:[a,b,c],color};}
function quad(a,b,c,d,color){return [triangle(a,b,c,color),triangle(a,c,d,color)];}
function landMesh(){
  const rows=53,cols=48,step=76, terrain=[];
  const vertex=(i,j)=>{const x=(i-cols/2)*step,z=(j-rows/2)*step;return [x,heightAt(x,z),z];};
  for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){
    const a=vertex(i,j),b=vertex(i+1,j),c=vertex(i+1,j+1),d=vertex(i,j+1);
    if(Math.max(a[1],b[1],c[1],d[1])<.2)continue;
    const slope=(b[1]-a[1])/step, grade=(d[1]-a[1])/step;
    const shade=clamp(.95+slope*.55+grade*.52+.1*Math.sin(i*6.7+j*4.5),.53,1.25);
    const height=(a[1]+b[1]+c[1]+d[1])*.25;
    const base=height<6?[138,128,96]:height>72?[89,101,72]:palette.ground;
    terrain.push(...quad(a,b,c,d,lit(base,shade)));
  }
  return terrain;
}
function paintedSurface(){
  const surface=[];
  const rect=(x,z,w,l,y,color)=>surface.push(...quad([x-w/2,y,z-l/2],[x+w/2,y,z-l/2],[x+w/2,y,z+l/2],[x-w/2,y,z+l/2],color));
  rect(0,0,46,1300,8.08,'#6c6c67');
  rect(101,241,135,253,8.09,'#77746a');rect(36,306,72,19,8.09,'#77746a');
  for(let z=-607;z<615;z+=33)rect(0,z,.45,15,8.11,'#dfd6c0');
  for(const x of [-21.5,21.5])rect(x,0,.47,1290,8.11,'#d6cdb8');
  for(let x=-15;x<=15;x+=3.35)for(const z of [-630,630])rect(x,z,1.3,13,8.11,'#e2d8c4');
  for(const x of [-23.4,23.4])for(let z=-640;z<=640;z+=29)rect(x,z,.48,.48,8.19,'#ffce91');
  return surface;
}
function buildings(){
  const objects=[];
  for(const [x,y,z,w,h,l] of [[123,8,161,17,11,29],[143,8,161,17,11,29],[163,8,161,17,11,29],[79,8,226,8,18,8],[79,26,226,10,4,10]]){
    const [a,b]=[x-w/2,x+w/2], [c,d]=[z-l/2,z+l/2], top=y+h;
    objects.push(...quad([a,y,c],[b,y,c],[b,top,c],[a,top,c],'#777970'));
    objects.push(...quad([a,y,d],[b,y,d],[b,top,d],[a,top,d],'#6c6c62'));
    objects.push(...quad([a,y,c],[a,y,d],[a,top,d],[a,top,c],'#989083'));
    objects.push(...quad([b,y,c],[b,y,d],[b,top,d],[b,top,c],'#5e6460'));
    objects.push(...quad([a,top,c],[b,top,c],[b,top,d],[a,top,d],'#535c5b'));
  }
  return objects;
}
function aircraftModel(mesh,occlusion){
  if(mesh.i.length!==occlusion.length)throw Error('Airframe shading does not match the model');
  const sample=sampleJetStencil(makeJetStencil());
  const vectors=mesh.p.map(point=>new T.Vector3(...point));
  const a=new T.Vector3(),b=new T.Vector3();
  const faces=[], midpoints=new Map();
  function midpoint(i,j){
    const key=Math.min(i,j)+':'+Math.max(i,j);
    if(!midpoints.has(key)){
      midpoints.set(key,vectors.length);
      vectors.push(vectors[i].clone().lerp(vectors[j],.5));
    }
    return midpoints.get(key);
  }
  function split(indices,normal,ambient,remaining){
    const [first,second,third]=indices.map(i=>vectors[i]);
    const minX=Math.min(first.x,second.x,third.x),maxX=Math.max(first.x,second.x,third.x);
    const minZ=Math.min(first.z,second.z,third.z),maxZ=Math.max(first.z,second.z,third.z);
    const nearCanopy=maxX>=-.54&&minX<=.54&&maxZ>=-1.72&&minZ<=-.07&&Math.max(first.y,second.y,third.y)>-.075;
    if(remaining>0&&nearCanopy&&Math.max(maxX-minX,maxZ-minZ)>.048){
      const [i,j,k]=indices,ij=midpoint(i,j),jk=midpoint(j,k),ki=midpoint(k,i);
      for(const triangle of [[i,ij,ki],[ij,j,jk],[ki,jk,k],[ij,jk,ki]])split(triangle,normal,ambient,remaining-1);
      return;
    }
    const center=first.clone().add(second).add(third).divideScalar(3);
    const [glass,seal]=sample(center.x,center.y,center.z);
    faces.push({indices,normal,center,glass,seal,ambient});
  }
  mesh.i.forEach((indices,index)=>{
    const [first,second,third]=indices.map(i=>vectors[i]);
    const normal=a.subVectors(second,first).cross(b.subVectors(third,first)).clone().normalize();
    split(indices,normal,(occlusion[index]/255)**2.3,3);
  });
  return {vectors,faces};
}

const reflection=new T.Vector3(), sight=new T.Vector3(), surfacePoint=new T.Vector3();
const mirrorMix=(a,b,t)=>a+(b-a)*t;
function mirrorRamp(a,b,value){
  const t=clamp((value-a)/(b-a),0,1);
  return t*t*(3-2*t);
}
const skyHighlight=new T.Vector3(-.21,.75,-.63).normalize();
function aircraftColor(face,normal,airframe,camera){
  surfacePoint.copy(face.center).applyQuaternion(airframe.quaternion).add(airframe.position);
  sight.subVectors(camera.position,surfacePoint).normalize();
  const facing=Math.max(0,normal.dot(sight));
  const sky=clamp(normal.y*.68+.32,0,1);
  const diffuse=Math.max(0,normal.dot(sun));
  reflection.copy(normal).multiplyScalar(2*facing).sub(sight);
  const skylight=Math.max(0,reflection.dot(skyHighlight));
  const glint=Math.max(0,reflection.dot(sun));
  const ambient=face.ambient;
  const diffusePaint=(.38+.34*sky+.21*diffuse)*(.22+.78*ambient);
  const reflectedPaint=(.050+.19*skylight**3+.20*glint**23)*ambient;
  const fresnel=(1-facing)**2;

  const paint=[
    83*diffusePaint+144*reflectedPaint+8*diffuse*ambient,
    89*diffusePaint+148*reflectedPaint+6*diffuse*ambient,
    98*diffusePaint+157*reflectedPaint
  ];
  if(!face.glass)return rgb(...paint.map(channel=>channel*(1-face.seal*.66)));
  const y=reflection.y;
  const horizon=mirrorRamp(-.14,.025,y), skyBlue=mirrorRamp(.045,.79,y);
  const cloud=Math.sin(19*y+3.4*reflection.x+1.9*Math.sin(reflection.z*7));
  const sheen=mirrorRamp(.54,.92,cloud)*mirrorRamp(.02,.24,y)*(1-mirrorRamp(.49,.91,y))*.54;
  const silver=[[53,207,100,219],[75,207,135,230],[90,205,168,238]];
  const glass=silver.map(([sea,haze,sky,white])=>mirrorMix(mirrorMix(mirrorMix(sea,haze,horizon),sky,skyBlue),white,sheen)
    +34*fresnel+40*glint**27);
  return rgb(...paint.map((channel,i)=>clamp(channel*(1-face.seal*.66)*(1-face.glass)+glass[i]*face.glass,0,255)));
}

function readHardware(group){
  const meshes=[];
  group.traverse(mesh=>{
    if(!mesh.isMesh)return;
    const {index,attributes:{position}}=mesh.geometry;
    const {material}=mesh;
    const color=material.color.getRGB(new T.Color(),T.SRGBColorSpace).toArray().map(c=>c*255);
    const vertices=Array.from({length:position.count},(_,i)=>new T.Vector3().fromBufferAttribute(position,i));
    const triangles=[];
    for(let i=0;i<(index?.count??vertices.length);i+=3){
      const indices=[0,1,2].map(j=>index?index.getX(i+j):i+j);
      const [a,b,c]=indices.map(j=>vertices[j]);
      const normal=b.clone().sub(a).cross(c.clone().sub(a)).normalize();
      if(normal.lengthSq()>0)triangles.push({indices,normal});
    }
    meshes.push({mesh,color,vertices,triangles,glowColor:color.map(Math.round).join(',')});
  });
  return meshes;
}

export async function createLite(hardware){
  const [response,occlusion]=await Promise.all([
    fetch('./models/personal-jet-stl-lite.json'),loadJetOcclusion('./models/jet-lite-ao.bin')
  ]);
  if(!response.ok)throw Error('Unable to load lightweight aircraft model');
  const aircraft=aircraftModel(await response.json(),occlusion);
  const attachments=readHardware(hardware);
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{alpha:false});
  const terrain=landMesh(),surface=paintedSurface(),objects=buildings();
  let width=1,height=1, ratio=1;
  let camera, focal, inverse=new T.Quaternion();
  const n=new T.Vector3(),direction=new T.Vector3(), local=new T.Vector3(), normalMatrix=new T.Matrix3();
  function view(x,y,z){
    local.set(x-camera.position.x,y-camera.position.y,z-camera.position.z).applyQuaternion(inverse);
    return [local.x,local.y,-local.z];
  }
  function point(p){return [width/2+p[0]*focal/p[2],height/2-p[1]*focal/p[2]];}
  function clip(vertices){
    const output=[];
    for(let i=0;i<vertices.length;i++){
      const a=vertices[i],b=vertices[(i+1)%vertices.length],aIn=a[2]>.35,bIn=b[2]>.35;
      if(aIn)output.push(a);
      if(aIn!==bIn){
        const t=(.35-a[2])/(b[2]-a[2]);
        output.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,.35]);
      }
    }
    return output;
  }
  function project(vertices,color,list,glow=false){
    const visible=clip(vertices);
    if(visible.length<3)return;
    const screen=visible.map(point);
    if(screen.every(p=>p[0]<0)||screen.every(p=>p[0]>width)||screen.every(p=>p[1]<0)||screen.every(p=>p[1]>height))return;
    list.push({screen,color,glow,depth:vertices.reduce((total,p)=>total+p[2],0)/vertices.length});
  }
  function paint(faces,stroke=false){
    faces.sort((a,b)=>b.depth-a.depth);
    let additive=false;
    for(const {screen,color,glow} of faces){
      ctx.beginPath();ctx.moveTo(...screen[0]);
      for(let i=1;i<screen.length;i++)ctx.lineTo(...screen[i]);
      ctx.closePath();
      if(glow!==additive){ctx.globalCompositeOperation=glow?'lighter':'source-over';additive=glow;}
      ctx.fillStyle=color;ctx.fill();
      if(stroke&&!glow){ctx.strokeStyle=color;ctx.lineWidth=.8;ctx.stroke();}
    }
    if(additive)ctx.globalCompositeOperation='source-over';
  }
  function landscape(cam,time){
    cam.getWorldDirection(direction);
    const horizon=height/2+focal*direction.y/Math.max(.28,Math.hypot(direction.x,direction.z));
    const roll=Math.atan2(2*(cam.quaternion.w*cam.quaternion.z+cam.quaternion.x*cam.quaternion.y),1-2*(cam.quaternion.x**2+cam.quaternion.z**2));
    const bound=Math.hypot(width,height)*1.1;
    ctx.save();ctx.translate(width/2,height/2);ctx.rotate(roll);ctx.translate(-width/2,-height/2);
    const grad=ctx.createLinearGradient(0,horizon-bound*.45,0,horizon+1);
    grad.addColorStop(0,'#43647a');grad.addColorStop(.56,'#899899');grad.addColorStop(1,'#c1a68a');
    ctx.fillStyle=grad;ctx.fillRect(-bound,-bound,width+2*bound,horizon+bound+1);
    const sea=ctx.createLinearGradient(0,horizon,0,horizon+height*.67);
    sea.addColorStop(0,'#a49884');sea.addColorStop(.22,'#63818a');sea.addColorStop(1,'#2e5966');
    ctx.fillStyle=sea;ctx.fillRect(-bound,horizon,width+2*bound,height+bound-horizon);
    ctx.restore();
    const sd=sun.clone().applyQuaternion(inverse);
    if(sd.z<-.05){
      const [sx,sy]=point([sd.x,sd.y,-sd.z]);
      if(sx>-width&&sx<width*2&&sy>-height&&sy<height*1.5){
        const glow=ctx.createRadialGradient(sx,sy,2,sx,sy,Math.max(width*.29,40));
        glow.addColorStop(0,'#ffe5aa');glow.addColorStop(.09,'#ffbe765e');glow.addColorStop(1,'#fdba7500');
        ctx.fillStyle=glow;ctx.fillRect(0,0,width,height);
        ctx.fillStyle='#ffe6b2';ctx.beginPath();ctx.arc(sx,sy,Math.max(3,width*.0042),0,Math.PI*2);ctx.fill();
      }
    }
    for(let i=0;i<21;i++){
      const theta=i*.618, x=Math.sin(theta)*4200,z=Math.cos(theta)*4200;
      const p=view(x,250+85*Math.sin(i*7.8),z);
      if(p[2]<300)continue;
      const [sx,sy]=point(p), r=clamp((95+45*Math.sin(i*4.9))*focal/p[2],9,width*.16);
      if(sx+r*3<0||sx-r*3>width||sy<0||sy>height)continue;
      ctx.save();ctx.translate(sx,sy);ctx.scale(3.5,.31);
      const cloud=ctx.createRadialGradient(0,0,0,0,0,r);
      cloud.addColorStop(0,'#c7bbaa64');cloud.addColorStop(.42,'#bdafa35d');cloud.addColorStop(1,'#c0b1a900');
      ctx.fillStyle=cloud;ctx.fillRect(-r,-r,r*2,r*2);ctx.restore();
    }
  }
  function render(cam,airframe,flight,time){
    camera=cam;inverse.copy(cam.quaternion).invert();focal=height*.5/Math.tan(cam.fov*Math.PI/360);
    landscape(cam,time);
    const ground=[];
    for(const face of terrain)project(face.points.map(p=>view(...p)),face.color,ground);
    paint(ground,true);
    const features=[];
    for(const face of surface)project(face.points.map(p=>view(...p)),face.color,features);
    for(const face of objects)project(face.points.map(p=>view(...p)),face.color,features);
    paint(features);
    const floor=heightAt(flight.x,flight.z);
    if(flight.y-floor<115){
      const q=view(flight.x+(flight.y-floor)*.19,floor+.06,flight.z+(flight.y-floor)*.19);
      if(q[2]>.6){
        const p=point(q),r=clamp(4.6*focal/q[2],3,width);
        ctx.save();ctx.translate(...p);ctx.scale(1,.33);
        const blur=ctx.createRadialGradient(0,0,0,0,0,r);
        blur.addColorStop(0,'rgba(24,29,26,'+clamp(.53-(flight.y-floor)*.006,0,.53)+')');
        blur.addColorStop(.6,'rgba(24,29,26,'+clamp(.34-(flight.y-floor)*.0038,0,.34)+')');
        blur.addColorStop(1,'rgba(24,29,26,0)');
        ctx.fillStyle=blur;ctx.fillRect(-r,-r,r*2,r*2);ctx.restore();
      }
    }
    if(!airframe.visible)return;
    const faces=[];
    const vertices=aircraft.vectors.map(p=>{n.copy(p).applyQuaternion(airframe.quaternion).add(airframe.position);return view(n.x,n.y,n.z);});
    for(const face of aircraft.faces){
      const [a,b,c]=face.indices.map(index=>vertices[index]);
      const winding=(b[0]*a[2]-a[0]*b[2])*(c[1]*a[2]-a[1]*c[2])-(b[1]*a[2]-a[1]*b[2])*(c[0]*a[2]-a[0]*c[2]);
      if(winding<=0)continue;
      n.copy(face.normal).applyQuaternion(airframe.quaternion);
      project([a,b,c],aircraftColor(face,n,airframe,camera),faces);
    }
    airframe.updateMatrixWorld(true);
    for(const {mesh,color,vertices,triangles,glowColor} of attachments){
      if(!mesh.parent.visible)continue;
      const glow=mesh.material.transparent;
      const coords=vertices.map(v=>{n.copy(v).applyMatrix4(mesh.matrixWorld);return view(n.x,n.y,n.z);});
      if(!glow)normalMatrix.getNormalMatrix(mesh.matrixWorld);
      const emission=glow?'rgba('+glowColor+','+mesh.material.opacity*.58+')':null;
      for(const {indices,normal} of triangles){
        const [a,b,c]=indices.map(i=>coords[i]);
        const winding=(b[0]*a[2]-a[0]*b[2])*(c[1]*a[2]-a[1]*c[2])-(b[1]*a[2]-a[1]*b[2])*(c[0]*a[2]-a[0]*c[2]);
        if(winding<=0&&mesh.material.side!==T.DoubleSide)continue;
        if(glow){project([a,b,c],emission,faces,true);continue;}
        n.copy(normal).applyNormalMatrix(normalMatrix);
        const shade=.58+.26*Math.max(0,n.y)+.42*Math.max(0,n.dot(sun));
        project([a,b,c],lit(color,shade),faces);
      }
    }
    paint(faces,true);
  }
  return {canvas,render,resize(w,h,dpr){
    width=w;height=h;ratio=Math.min(dpr,1.25);
    canvas.width=Math.round(w*ratio);canvas.height=Math.round(h*ratio);ctx.setTransform(ratio,0,0,ratio,0,0);
  }};
}
