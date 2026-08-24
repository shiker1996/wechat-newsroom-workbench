import test from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_JSON_ERROR_CODES, locateJsonValue, parseModelJson, parseModelJsonWithRepair } from '../server/platform/llm/model-json.mjs';

test('统一 JSON 解析剥离围栏并定位说明文字中的主对象',()=>{assert.deepEqual(parseModelJson({content:'说明如下：\n```json\n{"ok":true,"text":"} 不结束"}\n```'}),{ok:true,text:'} 不结束'});assert.equal(locateJsonValue('prefix [1,2] suffix').text,'[1,2]');});
test('length 和未闭合结构统一分类为稳定截断错误码',()=>{for(const result of [{content:'{"x":',finishReason:'stop'},{content:'{"x":1}',finishReason:'length'}])assert.throws(()=>parseModelJson(result),(error)=>error.code===MODEL_JSON_ERROR_CODES.TRUNCATED);});
test('无 JSON 与语法错误使用稳定无效输出错误码并写审计',()=>{const updates=[];assert.throws(()=>parseModelJson({callId:7,content:'not json'},{store:{updateModelCall(id,value){updates.push({id,value});}},label:'测试'}),(error)=>error.code===MODEL_JSON_ERROR_CODES.INVALID);assert.equal(updates[0].value.status,'invalid_output');assert.match(updates[0].value.error,/MODEL_JSON_INVALID/);});
test('结构修复最多调用一次并返回统一结果',async()=>{let repairs=0;const parsed=await parseModelJsonWithRepair({content:'bad'},{label:'测试',repair:async()=>{repairs+=1;return {content:'```json\n{"fixed":true}\n```'};}});assert.deepEqual(parsed,{fixed:true});assert.equal(repairs,1);repairs=0;await assert.rejects(()=>parseModelJsonWithRepair({content:'bad'},{label:'测试',repair:async()=>{repairs+=1;return {content:'still bad'};}}),(error)=>error.code===MODEL_JSON_ERROR_CODES.REPAIR_FAILED);assert.equal(repairs,1);});
