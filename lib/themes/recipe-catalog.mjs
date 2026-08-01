export const ARTICLE_THEME_RECIPES = Object.freeze({
  frame:['warm-frame','gossip-frame','terminal-frame','report-frame','letter-frame','news-frame'],
  kicker:['none','chip','mono-line','center-label'],
  h1:['editorial-serif','gossip-title','terminal-title','center-double','serif-display','invert-block'],
  h2:['numbered-rule','eyebrow-border','terminal','center-double','cn-number','invert-tag'],
  lead:['none','rule-bottom'], quote:['warm-card','dark-block','terminal-panel','boxed','quote-marks','plain-bar'],
  divider:['ornament','hairline','mono-comment','rule-mark','stars','thick-bar'],
  list:['default','chevron','news-panel'], table:['tinted-header','dark-header','ink-header'], image:['plain','rounded','framed'],
});

export const SOCIAL_THEME_RECIPES = Object.freeze({
  surface:['base','palette','neon','brutalist'],
  frame:['soft-orbit','palette-frame','neon-frame','brutalist-frame'],
  decoration:['orbit','scanlines','paper-offset','soft-blur','circle','none'],
  eyebrow:['plain','accent','stamp','underline'], ending:['dark-fill','accent-fill','hard-fill'],
  list:['soft-card','tinted-card','outlined-card','hard-card'], code:['dark-panel','terminal-panel','hard-panel'],
});

export const THEME_RECIPE_CATALOG = Object.freeze({ article:ARTICLE_THEME_RECIPES, social:SOCIAL_THEME_RECIPES });
