# 07 · 联调交接：接口与参数

版本 v2.0 / 2026-10-20。本文顶部描述当前 Vue 工作流；Octop 路由的完整 request/response schema 以本机 `/api/docs` 为准。下方旧版独立 FastAPI 接口表仍服务兼容合同测试，不是当前 Vue 办理会话的数据源。

## 当前 Vue 工作流（权威）

- `/api/admission-registration/v1/*` 由登录后的 Octop API 处理：身份核验、本人申请单查询/选择、session/turn 读取保存、review、提交及结果查询。会话归属从登录用户、演示患者和申请单三者校验；最长24小时到期，成功重新核验时提前删除该患者旧会话。
- `/api/admission-demo/*` 使用 Octop 当前活动模型。字段提取携带当前会话、当前 utterance、申请单/已确认事实摘要和最近4轮；服务端按模型 tokenizer 限制在6000 token以内。超限、429、超时/网络错误分别返回，禁止自动重试风暴。
- `/api/voice/*` 沿用 Octop 语音服务。Vite 把三类 `/api` 路径转到 `OCTOP_API_ORIGIN`（默认 `http://127.0.0.1:8200`）；部署构建必须与 Octop 同源，不能把办理 API 转给旧独立服务。
- `frontend/src/api/admission.js` 是 Vue API 请求合同；OpenAPI summary/schema 可在 `/api/docs` 检查。身份核验临时 token 为进程态，服务重启后需重新核验；重新核验会清空同一用户该演示患者的旧 DB 会话，不恢复旧对话。
- Mock 医院申请单和提交结果不代表真实 HIS；录音不落盘，通话文本只保留到会话到期。

以下为兼容中的独立 Python mock API（loopback `8765`）合同；新 Vue 页面不应将这些 API 当作 session/AI authority。

## 1. 地址、鉴权与通用约定

| 项目 | 约定 |
| --- | --- |
| 入院登记 mock API 前缀 | `/api/admission-registration/v1` |
| 平台 API 前缀 | `/api` |
| mock 服务默认地址 | `http://127.0.0.1:8765`，只绑定 loopback |
| AI 上游平台地址 | 服务端 `OCTOP_API_BASE_URL`，默认 `http://127.0.0.1:8200`；客户端不可传入上游 URL |
| 旧版本地前端代理 | 历史独立 mock 的直连配置；新 Vue 页面将全部 `/api/admission-registration/*` 转到 Octop |
| 字符编码 | UTF-8 JSON；字段名区分大小写，采用 camelCase（平台返回字段例外，见 AI 表） |
| 登录态 | mock 登记接口不要求 Octop 登录；平台语音和 AI 需 Octop Bearer token。Bearer token 不放 URL 或请求正文；mock `identityToken` 仅放 JSON 请求体 |
| 令牌续期 | 前端读取响应头 `X-Octop-Access-Token`；存在时按原 token 存储位置更新 |
| 跨域 | mock API 默认仅允许 `localhost:5173`、`127.0.0.1:5173`；部署用同源反向代理 |
| 模拟数据 | 响应带 `mock: true`。内存状态会在服务重启后清除，不代表真实患者/医院数据 |

JSON 请求通常发送 `Content-Type: application/json`。语音上传是 `multipart/form-data`，浏览器负责生成 boundary；不要手工设置该请求的 `Content-Type`。

## 2. 入院登记 mock API

### 2.1 健康检查

`GET /api/admission-registration/v1/health`

无请求参数、无鉴权。

成功响应 `200`：

```json
{"status":"ok"}
```

### 2.2 身份核验 mock

`POST /api/admission-registration/v1/identity/verify`

无鉴权。请求体只接受以下字段；未列字段会被拒绝。

| 参数 | 类型 | 必填 | 约束/取值 |
| --- | --- | --- | --- |
| `method` | string | 是 | `id_card`、`social_card`、`insurance_qr` |
| `mockScenario` | string | 否 | 默认 `success`；`success`、`failed`、`no_profile` |

成功 `200` 响应：

```json
{
  "mock": true,
  "verified": true,
  "identityToken": "服务生成的短期令牌",
  "fields": {
    "name": "吴晓东",
    "idNumber": "211003198709081234",
    "phone": "13841928804",
    "nationality": "中国",
    "ethnicity": "汉族",
    "nativeRegion": [],
    "residentRegion": [],
    "addressDetail": "",
    "employerName": "",
    "employerAddress": "",
    "marriage": "",
    "occupation": "",
    "emergencyContact": "",
    "relationship": ""
  }
}
```

模拟失败返回 `422`；`no_profile` 返回 `404`；服务容量达到上限返回 `503`。失败响应不会发放 `identityToken`。令牌有效期为30分钟。

### 2.3 字段校验

`POST /api/admission-registration/v1/validate`

无鉴权。请求：`{"fields": { ...完整14字段对象... }}`。不接受额外 body 顶层字段。前端使用同一文件 `contracts/admission-fields.schema.json`；后端还验证省/市/区是否属于一条真实 mock 父子路径。

| 字段 | 类型 | 必填 | 校验规则 |
| --- | --- | --- | --- |
| `name` | string | 是 | 1–40字符 |
| `idNumber` | string | 是 | 1–32字符；提交时还必须与核验快照一致 |
| `phone` | string | 是 | `^1[3-9][0-9]{9}$` |
| `nationality` | string | 是 | 1–40字符；提交时与核验快照一致 |
| `ethnicity` | string | 是 | 1–40字符；提交时与核验快照一致 |
| `nativeRegion` | string[] | 是 | `[]` 或有效三级地区路径 |
| `residentRegion` | string[] | 是 | `[]` 或有效三级地区路径 |
| `addressDetail` | string | 是 | 最多200字符，可为空 |
| `employerName` | string | 是 | 最多50字符；中英文、数字、空格、中点、括号、连字符，可为空 |
| `employerAddress` | string | 是 | 同 `employerName` |
| `marriage` | string | 是 | `未婚`、`已婚`、`离异`、`丧偶` |
| `occupation` | string | 是 | `职工`、`农民`、`退休`、`无业`、`学生`、`其他` |
| `emergencyContact` | string | 是 | 1–40字符；中文/英文/中点/空格 |
| `relationship` | string | 是 | `配偶`、`子女`、`父母`、`祖父母/外祖父母`、`孙辈/外孙辈`、`兄弟姐妹`、`其他亲属`、`非亲属` |

合法响应 `200`：`{"valid":true,"errors":{}}`。不合法响应 `422`：`{"valid":false,"errors":{"phone":"请输入有效的11位手机号码"}}`。错误对象以字段名为 key；前端应保留草稿并将错误贴到对应控件。

### 2.4 地区选项 mock

`GET /api/admission-registration/v1/regions?parentCode={code}`

无鉴权。`parentCode` 可省略：省略时返回省级；传任意有子级的地区代码时返回下一级，末级选项标记 `leaf: true`。不同地区真实层级可能为两级或三级。无效代码返回 `404`。完整区县级数据及来源见 `contracts/regions.mock.json` 和 `docs/10-region-data-source.md`。

成功响应：`{"mock":true,"items":[{"value":"210000","label":"辽宁省","leaf":false}]}`。`leaf` 表示当前项是否末级。当前 Vue 表单直接读取共享 mock 地区合同，提供此路由用于接口联调。

### 2.5 创建模拟登记

`POST /api/admission-registration/v1/submissions`

无鉴权；服务端使用 `identityToken` 将本次请求绑定到刚核验的模拟身份。提交前强制复验完整字段、地区路径及只读字段快照。

| 参数 | 类型 | 必填 | 约束/取值 |
| --- | --- | --- | --- |
| `identityToken` | string | 是 | 1–64字符；身份核验返回；30分钟有效 |
| `idempotencyKey` | string | 是 | 8–128字符；同一提交意图重试时保持不变 |
| `mockScenario` | string | 否 | 默认 `success`；`success`、`failed`、`already_registered`、`unknown` |
| `fields` | object | 是 | 完整14字段对象，规则见2.3 |

成功响应 `200` 的公共字段：

```json
{"mock":true,"status":"success","receiptId":"SIM-ABC1234567","notificationSent":false,"printSucceeded":false}
```

`status` 取 `success`、`failed`、`already_registered`、`unknown`。只有 `success` 产生模拟 `receiptId`；通知和打印标志均为 `false`，不代表已真实发送或打印。其他状态可返回 `receiptId`、`notificationSent`、`printSucceeded` 为 `null`。

同一身份 + 幂等键 + 相同请求返回相同结果；同一键不同字段或情景返回 `409`。同一 mock 患者已成功或结果未知时，新的核验会话也不能用新键重复提交：成功时返回 `already_registered`，待确认时仍返回 `unknown`。已明确失败不锁定后续重试。非法字段返回 `422`，只读身份字段被改返回 `409`，身份失效返回 `401`，服务容量不足返回 `503`。

### 2.6 查询原提交结果

`POST /api/admission-registration/v1/submissions/result`

请求 JSON：`{"identityToken":"核验返回的短期 mock 令牌","idempotencyKey":"原提交幂等键"}`。两个字段必填，额外字段拒绝。令牌放在请求体，避免在 URL、代理访问日志和浏览器历史中暴露。身份令牌失效返回 `401`。已找到时响应与创建登记相同；没有对应幂等记录时返回 `{"mock":true,"status":"unknown","receiptId":null,"notificationSent":null,"printSucceeded":null}`。结果未知时必须继续查询同一键，不能换新键模拟重提。

### 2.7 入院 AI 候选安全代理

`POST /api/admission-registration/v1/ai/candidates`

需要 `Authorization: Bearer <Octop登录token>`。后端校验 `identityToken` 对应的身份核验会话未过期（30 分钟 TTL），随后将当前转写和表单页码转发到固定配置的 Octop `POST /api/admission-demo/extract`，不会接受客户端目标地址或历史上下文。

| 参数 | 类型 | 必填 | 约束 |
| --- | --- | --- | --- |
| `text` | string | 是 | 1–2000字符；仅本轮转写 |
| `page` | int | 是 | 1 或 2；限定当页可回填字段 |
| `identityToken` | string | 是 | 核验返回的短期 mock 令牌；过期/未知返回 `401` |

响应：`{"fields":{...}}`，值可为字符串或省市区代码数组。按页白名单回填：第 1 页 `phone`、`nativeRegion`、`residentRegion`（三级代码数组）、`addressDetail`；第 2 页 `employerName`、`employerAddress`、`marriage`、`occupation`、`emergencyContact`、`relationship`。文本字段必须是原话子串；枚举字段必须命中表单枚举，由模型负责把“女儿”归一化为“子女”。籍贯/现住址原文需能在模拟地区库逐级匹配成三级代码；现住地址匹配失败时原文并入 `addressDetail`，籍贯匹配失败直接丢弃。含歧义词（可能/或者等）或一句话出现多个手机号时整体拒绝。模型正常响应但未抽取到有效字段时 `fields` 为空对象。模型不可用或调用超时返回 Octop 503 `AI_MODEL_UNAVAILABLE`，独立服务代理会返回 502/504；不能把服务故障当作空候选。AI 返回不是已提交/已确认资料。401 表示无登录态或身份会话失效；若上游续签 token，代理响应会转发 `X-Octop-Access-Token`。

## 3. Octop 平台语音与 AI 接口

以下路径是 demo 直接使用的既有平台接口，均走同源 `/api`，需要有效 Bearer token。除 TTS 外，响应为 JSON。

### 3.1 当前语音配置

`GET /api/voice/active`

无参数。返回当前用户配置的语音服务，例如：`{"stt":"provider-name","tts":"provider-name","stt_realtime":false}`。Demo 只用它确认平台语音配置/可用性，不允许客户端指定供应商覆盖。

### 3.2 一句话语音识别（STT/ASR）

`POST /api/voice/stt`，`multipart/form-data`。

| 参数 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `audio` | form file | File | 是 | 用户录制的音频文件；浏览器传 MIME type |
| `language` | form field | string | 否 | 默认为 `zh-CN`；Demo 显式传 `zh-CN` |
| `provider` | form field | string | 否 | 可选覆盖项；Demo 不传，使用平台活动配置 |

成功响应：`{"text":"识别出的文字","confidence":null}`。`confidence` 可为数字或 null。空文件会返回错误；401 为登录失效；其他错误按 Octop API 错误 envelope 返回。没有明确的前端上传字节上限；当前页面将单次录音限制为60秒、上传等待限制为30秒。

浏览器录音器可能生成 WebM/Opus；Demo 在上传前使用 Web Audio 解码并转为单声道 PCM16 WAV，上传文件 MIME/扩展名均为 `audio/wav` / `.wav`，以兼容当前豆包 ASR 格式限制。

### 3.3 文本转语音（TTS）

`POST /api/voice/tts`，JSON：

| 参数 | 类型 | 必填 | 默认/范围 |
| --- | --- | --- | --- |
| `text` | string | 是 | 1–8000字符 |
| `voice_id` | string \| null | 否 | `null`，可选音色 ID |
| `speed` | number | 否 | `1.0`，范围0.5–2.0 |
| `provider` | string \| null | 否 | `null`，不覆盖平台当前配置 |

Demo 只发送 `{"text":"当前步骤提示语"}`。响应为音频流，Content-Type 由平台供应商决定，不要固定假设 MP3。页面请求截止15秒，播放结束或离页需释放音频 URL。

### 3.4 当前入院 AI 提取接口

`POST /api/admission-demo/extract`，需要平台登录。

请求：`{"text":"患者当前这一轮明确说出的内容","page":1}`；`text` 为1–2000字符，`page` 为 1 或 2（可缺省，默认 1）。

响应：`{"fields":{...}}`，按页返回白名单键。第 1 页：`contact_phone`、`native_region`（籍贯省市区原文）、`resident_region`（现住省市区原文）、`address`（现住详细地址原文）；第 2 页：`employer_name`、`employer_address`、`marriage`、`occupation`、`emergency_contact`、`relationship`（后三个枚举键由模型提示词归一化到表单枚举）。平台只做键位与长度过滤，原文证据与枚举合法性由 Demo 代理校验。平台模型未配置/失败时也可能返回 `{"fields":{}}`，HTTP 200 不代表识别到了字段。

## 4. 状态码与前端处理

| HTTP 状态 | 语义 | 客户端处理 |
| --- | --- | --- |
| `200` | 成功，或字段合法 | 渲染响应；候选仍需前端二次格式验证 |
| `401` | 平台登录失效或身份 token 过期 | 保留安全提示；重新登录/重新核验，不伪报成功 |
| `404` | mock 档案/地区不存在 | 显示“未找到”状态，不进入后续登记 |
| `409` | 只读身份或幂等冲突 | 禁止覆盖/新键规避，提示重新核验或查询 |
| `422` | 请求字段或表单合同不合法 | 按 `detail.errors` 将错误映射到字段，保留输入 |
| `502` / `504` | 平台 AI 上游失败/超时 | 转写与手填草稿保留，进入人工填写路径 |
| `503` | mock 服务容量暂满 | 提示稍后重试，不修改幂等键 |
| 网络超时/断连 | 提交结果不确定 | 页面进入待确认，查询原 `identityToken + idempotencyKey`，不得直接生成新提交意图 |

错误响应可能来自 Pydantic 校验、Octop 全局错误 handler 或 demo 自定义错误，不能假设全部使用相同 JSON 结构。接口调用方应先检查 HTTP 状态，再按对应 endpoint 的错误 envelope 解析。

## 5. 前后端改动入口与合同文件

| 位置 | 责任 |
| --- | --- |
| `contracts/admission-fields.schema.json` | 前后端共用字段名称、类型、必填、格式与长度约束 |
| `contracts/regions.mock.json` | 前后端共用演示地区数据 |
| `frontend/src/api/admission.js` | HTTP、平台登录 token、续期响应头、上传与音频流 |
| `frontend/src/model/validation.js` | 浏览器端 JSON Schema 校验 |
| `backend/src/admission_registration/main.py` | FastAPI 路由与请求模型 |
| `backend/src/admission_registration/contracts.py` | 服务端 Schema 和地区路径复验 |
| `backend/src/admission_registration/ai.py` | AI 候选白名单、来源原文及安全过滤 |
| `backend/src/admission_registration/store.py` | 进程内 mock 身份、患者级重复登记和幂等结果 |

字段合同变更必须同时检查前端字段分组、页面核对展示、`tests/contracts.test.js`、`tests/test_contract.py` 和本交接文档；接口参数变更必须同步前端调用、后端模型、`04-development.md` 与本交接文档。

## 6. 本地联调命令

```powershell
# 终端一：后端 mock API
cd demos/admission-registration/backend
.venv\Scripts\python.exe -m uvicorn admission_registration.main:app --app-dir src --host 127.0.0.1 --port 8765

# 终端二：Vue 原型
cd demos/admission-registration/frontend
npm run dev
```

检查后端接口清单：`http://127.0.0.1:8765/docs`。平台语音/AI需要登录 Octop 且同源部署；本地无平台 token 时只能验证鉴权失败，不可把该结果记录为平台联调通过。
