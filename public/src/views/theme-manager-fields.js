export const colorFields=['background','surface','page','text','muted','accent','accentSecondary','line','inverseText','codeBackground'];
export const labels={background:'背景',surface:'内容表面',page:'画布',text:'正文',muted:'弱化文字',accent:'主强调',accentSecondary:'次强调',line:'边线',inverseText:'反白文字',codeBackground:'代码背景'};
export const socialColorLabels={page:'图文页背景'};
export const coverColorLabels={page:'画布底色',text:'标题文字',muted:'副标题/信息行',accent:'主强调',accentSecondary:'次强调',inverseText:'反白文字',codeBackground:'深色色块'};
export const coverTokenGroups={
  typography:{label:'字体与字阶',hint:'控制封面大标题、眉题、副标题与信息行的字号层级',fields:[
    ['family','正文字体','select',['sans','serif','mono']],['headingFamily','标题字体','select',['sans','serif','mono']],
    ['titlePx','标题字号上限','number',30,56,1,'px'],['titleLineHeight','标题行高','number',1.1,1.6,.02,''],
    ['eyebrowPx','眉题字号','number',14,24,1,'px'],['subtitlePx','副标题字号','number',16,26,1,'px'],
    ['metaPx','信息行字号','number',12,20,1,'px']
  ]},
  spacing:{label:'留白与间距',hint:'控制内容区内边距、元素间距与信息行位置',fields:[
    ['paddingXPx','内容区水平留白','number',24,64,1,'px'],['paddingYPx','内容区垂直留白','number',20,56,1,'px'],
    ['gapPx','元素间距','number',8,32,1,'px'],['metaBottomPx','信息行距底','number',12,48,1,'px']
  ]},
  shape:{label:'形状',hint:'控制眉题徽章的圆角',fields:[['badgeRadiusPx','徽章圆角','number',0,16,1,'px']]},
};
export const tokenGroups={
  typography:{label:'字体与字阶',hint:'控制正文、标题、注释、行高与字间距',fields:[
    ['family','正文字体','select',['sans','serif','mono']],['headingFamily','标题字体','select',['sans','serif','mono']],
    ['bodyPx','正文字号','number',9,18,1,'px'],['h1Px','一级标题','number',22,44,1,'px'],
    ['h2Px','二级标题','number',11,28,1,'px'],['captionPx','注释字号','number',8,15,1,'px'],
    ['lineHeight','正文行高','number',1.2,2.1,.05,''],['letterSpacingEm','字间距','number',-.08,.2,.005,'em']
  ]},
  spacing:{label:'间距节奏',hint:'控制画布留白、章节、段落和卡片间距',fields:[
    ['articlePaddingPx','页面内边距','number',0,40,1,'px'],['sectionPx','章节间距','number',12,48,1,'px'],
    ['paragraphPx','段落间距','number',6,28,1,'px'],['cardGapPx','卡片间距','number',0,28,1,'px']
  ]},
  shape:{label:'形状与层次',hint:'控制圆角、边线宽度和阴影语气',fields:[
    ['radiusPx','圆角','number',0,32,1,'px'],['borderWidthPx','边线宽度','number',0,8,1,'px'],
    ['shadow','阴影','select',['none','soft','hard','glow']]
  ]},
};
export const optionLabels={sans:'无衬线',serif:'衬线',mono:'等宽',none:'无',soft:'柔和阴影',hard:'硬边阴影',glow:'发光',grid:'网格',scanlines:'扫描线','paper-grain':'纸张颗粒',accent:'强调色',ink:'正文墨色'};
export const targetLabels={article:'文章',social:'图文',cover:'封面'};
export const targetLabel=(target)=>targetLabels[target]||target;
export const socialTokenLimits={bodyPx:[9,13],h1Px:[22,34],h2Px:[11,18],captionPx:[8,11],lineHeight:[1.2,1.55],articlePaddingPx:[0,28],sectionPx:[12,28],paragraphPx:[6,12],cardGapPx:[0,14]};
