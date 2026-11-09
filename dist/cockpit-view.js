import {canopyPanes} from './canopy-panes.js';

export const cockpitEye=[0,.135,-.50];
export const cockpitFov=68;

function clipWindow(ring){
  const clipped=[];
  const near=.035;
  for(let i=0;i<ring.length;i++){
    const a=ring[i],b=ring[(i+1)%ring.length],inside=a[2]>=near,nextInside=b[2]>=near;
    if(inside)clipped.push(a);
    if(inside===nextInside)continue;
    const fraction=(near-a[2])/(b[2]-a[2]);
    clipped.push([a[0]+fraction*(b[0]-a[0]),a[1]+fraction*(b[1]-a[1]),near]);
  }
  return clipped;
}
const openings=canopyPanes.map(pane=>clipWindow(pane.map(([x,y,z],i)=>{
  const before=pane[(i+pane.length-1)%pane.length][1],after=pane[(i+1)%pane.length][1];
  return [x-cockpitEye[0],(before+2*y+after)/4-cockpitEye[1],cockpitEye[2]-z];
})));
export function paintCockpit(canvas,width,height,ratio){
  const pixels=Math.min(ratio,1.65);
  canvas.width=Math.round(width*pixels);
  canvas.height=Math.round(height*pixels);
  const context=canvas.getContext('2d');
  context.setTransform(pixels,0,0,pixels,0,0);
  const focal=height*.5/Math.tan(cockpitFov*Math.PI/360);
  const frame=context.createLinearGradient(0,0,0,height);
  frame.addColorStop(0,'#26333c');frame.addColorStop(.44,'#3e4b51');
  frame.addColorStop(.61,'#222c31');frame.addColorStop(1,'#0d161b');
  context.fillStyle=frame;context.fillRect(0,0,width,height);
  const paths=openings.filter(ring=>ring.length>2).map(ring=>{
    const path=new Path2D();
    ring.forEach(([x,y,depth],i)=>{
      const sx=width*.5+focal*x/depth,sy=height*.5-focal*y/depth;
      if(i===0)path.moveTo(sx,sy);else path.lineTo(sx,sy);
    });
    path.closePath();return path;
  });
  context.globalCompositeOperation='destination-out';
  for(const path of paths)context.fill(path);
  context.globalCompositeOperation='source-over';
  context.lineJoin='round';
  for(const path of paths){
    context.strokeStyle='#101b22';context.lineWidth=5;context.stroke(path);
    context.strokeStyle='#718187';context.lineWidth=1;context.stroke(path);
  }
}
