import fs from 'node:fs';

const table=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k+=1)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc32(buffer){let crc=0xffffffff;for(const byte of buffer)crc=table[(crc^byte)&0xff]^(crc>>>8);return (crc^0xffffffff)>>>0;}
function dosDateTime(date){const d=new Date(date);return {time:(d.getHours()<<11)|(d.getMinutes()<<5)|(d.getSeconds()>>1),date:((Math.max(1980,d.getFullYear())-1980)<<9)|((d.getMonth()+1)<<5)|d.getDate()};}

export function createZip(files){
  const local=[];const central=[];let offset=0;
  for(const file of files){const data=fs.readFileSync(file.path);const name=Buffer.from(file.name.replace(/\\/g,'/'),'utf8');const crc=crc32(data);const stamp=dosDateTime(fs.statSync(file.path).mtime);
    const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(0,8);header.writeUInt16LE(stamp.time,10);header.writeUInt16LE(stamp.date,12);header.writeUInt32LE(crc,14);header.writeUInt32LE(data.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(name.length,26);
    local.push(header,name,data);
    const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50,0);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);entry.writeUInt16LE(0x800,8);entry.writeUInt16LE(0,10);entry.writeUInt16LE(stamp.time,12);entry.writeUInt16LE(stamp.date,14);entry.writeUInt32LE(crc,16);entry.writeUInt32LE(data.length,20);entry.writeUInt32LE(data.length,24);entry.writeUInt16LE(name.length,28);entry.writeUInt32LE(offset,42);central.push(entry,name);offset+=header.length+name.length+data.length;
  }
  const centralBuffer=Buffer.concat(central);const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(centralBuffer.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,centralBuffer,end]);
}
