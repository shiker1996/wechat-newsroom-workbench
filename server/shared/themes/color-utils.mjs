const HEX=/^#[0-9a-f]{6}$/i;
function channels(hex){return [1,3,5].map((index)=>Number.parseInt(hex.slice(index,index+2),16));}
function luminance(hex){const values=channels(hex).map((value)=>value/255).map((value)=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4);return .2126*values[0]+.7152*values[1]+.0722*values[2];}
export function colorContrast(foreground,background){if(!HEX.test(foreground||'')||!HEX.test(background||''))return 0;const values=[luminance(foreground),luminance(background)].sort((a,b)=>b-a);return (values[0]+.05)/(values[1]+.05);}
export function mixHex(from,to,ratio){if(!HEX.test(from||'')||!HEX.test(to||'')||!Number.isFinite(ratio))return from;const left=channels(from),right=channels(to),weight=Math.min(1,Math.max(0,ratio));return `#${left.map((value,index)=>Math.round(value+(right[index]-value)*weight).toString(16).padStart(2,'0')).join('')}`.toUpperCase();}
