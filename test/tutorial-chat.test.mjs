import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTutorialChatReadiness, sanitizeTutorialUpdates, tutorialChatMessages } from '../server/features/articles/llm/tutorial-chat.mjs';

test('教程对话只接受表单字段并过滤非 HTTP 素材链接', () => {
  assert.deepEqual(sanitizeTutorialUpdates({
    articleMode: 'experience',
    topic: '启动项目',
    steps: ['安装', '启动'],
    materialUrls: ['https://example.com', 'E:\\demo'],
    injected: 'no',
  }), { articleMode: 'experience', topic: '启动项目', steps: ['安装', '启动'], materialUrls: ['https://example.com'] });
});

test('教程对话只接受两种自主写作模式', () => {
  assert.deepEqual(sanitizeTutorialUpdates({ articleMode: 'news', topic: '主题' }), { topic: '主题' });
});

test('教程对话明确本地项目只是素材而非执行证明', () => {
  const messages = tutorialChatMessages({
    draft: {},
    projectContext: { summary: '读取 1/1 个文本文件', truncated: false, files: [{ path: 'README.md', excerpt: 'npm run dev', truncated: false }] },
  });
  assert.match(messages[0].content, /绝不是“已执行成功”的证明/);
  assert.match(messages[1].content, /README\.md/);
  assert.doesNotMatch(messages[1].content, /E:\\/);
  assert.match(messages[0].content, /必须在 cap_agent_form_update 的 points 操作文本前实际写入“【体验】”/);
});

test('教程对话就绪状态由完整事实表确定而不是采信模型自报', () => {
  const incomplete=evaluateTutorialChatReadiness({draft:{articleMode:'tutorial',topic:'启动工具'},updates:{points:['建议一','建议二','建议三']}});
  assert.equal(incomplete.ready,false);
  assert.deepEqual(incomplete.missing,['目标读者','实际环境或版本','至少 2 个实际步骤','作者体验或用户素材']);
  const complete=evaluateTutorialChatReadiness({
    draft:{articleMode:'tutorial',topic:'启动工具',audience:'开发者',environment:'Windows 11'},
    updates:{points:['项目说明','启动方式','配置位置'],steps:['安装依赖','启动服务']},
    projectContext:{files:[{path:'README.md'}]},
  });
  assert.equal(complete.ready,true);
});
