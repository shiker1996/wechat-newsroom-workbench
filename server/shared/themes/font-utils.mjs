// 使用设备端字体栈；主题角色优先表达设计意图，缺失字体时由设备自行回退。
// serif 保留为兼容别名，具体主题可使用 song / kai / hei 表达更明确的中文字族。
export function fontStack(role,{singleQuotes=false}={}){
  const value={
    mono:'Consolas,ui-monospace,monospace',
    serif:'Georgia,"SimSun","宋体",serif',
    song:'"SimSun","宋体",Georgia,serif',
    kai:'"STKaiti","KaiTi","楷体",cursive',
    hei:'"SimHei","黑体",Arial,sans-serif',
    sans:'-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB",Arial,sans-serif',
  }[role] || '-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB",Arial,sans-serif';
  return singleQuotes?value.replace(/"/g,"'"):value;
}
