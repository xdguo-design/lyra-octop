# HIS ontology backend

这是当前仓库中的 HIS 后端起点，先把**全 HIS 共享概念语义**作为运行时核心，并以医生站诊断关系作为首个领域切片。

## DDD 与本体在代码中的分工

- `his_backend/ontology/his-core.ttl` 是全局本体：定义 `Patient`、`Encounter`、`DiagnosisAssertion`、`ClinicalOrder` 等概念及允许的关系。
- 挂号接诊链以 `RegistrationRecord → OutpatientQueueEntry → WorkgroupMembership → Practitioner` 建模；挂号状态、候诊状态和组内角色仍由各自业务域管理。
- `his_backend/doctor_station/` 是医生站领域：定义诊断断言，并由应用服务将一次诊断表达为本体关系、执行语义校验。
- `his_backend/orders/` 是医嘱领域核心：区分门诊/住院医嘱，使用类型化申请单与明细、显式状态枚举和不可变操作记录模型；只包含领域规则，不负责连接旧 HIS 物理表。
- `his_backend/app.py` 是 HTTP 适配层：公开本体目录、关系校验和能力门禁。

DDD 继续承载业务行为和流程边界；本体为跨模块概念提供共同定义。当前只校验类继承、关系 domain/range，不接入推理机或图数据库。

## 运行

```powershell
cd his-backend
uv sync
uv run uvicorn his_backend.app:app --reload --host 127.0.0.1 --port 8190
```

打开 `http://127.0.0.1:8190/docs` 查看 API。

## API

- `GET /api/v1/ontology`：返回已定义概念与关系。
- `POST /api/v1/ontology/validate`：校验给定关系的主体/客体类型是否符合本体。
- `POST /api/v1/doctor-station/diagnoses/validate`：校验医生站诊断事实所需的概念关系，不保存诊断或患者数据。
- `GET /api/v1/doctor-station/capabilities`：报告医生站临床写入门禁。

示例：

```powershell
Invoke-RestMethod http://127.0.0.1:8190/api/v1/ontology
Invoke-RestMethod -Method Post `
  -Uri http://127.0.0.1:8190/api/v1/doctor-station/diagnoses/validate `
  -ContentType 'application/json' `
  -Body '{"diagnosis_id":"opaque-id","patient_id":"opaque-patient","encounter_id":"opaque-encounter","practitioner_id":"opaque-practitioner","concept_uri":"urn:validation:condition","concept_type":"ConditionTerminologyConcept"}'
```

该接口只验证关系类型，不确认概念 URI 是否来自已批准的 ICD 目录，也不代表诊断已保存或临床有效。

## 当前边界

门诊医生站 PRD 将 `#36` 院方签字和授权契约设为真实临床写入门禁；签字前 `checkCommitReadiness().permitted` 必须为 `false`。因此当前后端不提供患者诊断保存、医嘱保存/提交或任何临床数据写入 API。也没有患者数据、静态临床样例、数据库仓储或外部 EHR 适配器。

本机当前观察到工作组服务在 `http://127.0.0.1:8080` 提供受保护的 `/api/v1/workgroups`、`/api/v1/staff/{staffCode}/workgroups` 与主工作组 API；无员工会话时返回 `401`。文档记录的挂号服务 `http://127.0.0.1:18101` 当前未监听；`18103` 的 OpenAPI 仅包含认证/人员账号接口，没有挂号查询接口。因此本体已具备接线关系，真实连接器需要员工会话和挂号服务启动后才能实现/验证。

这不是完整 HIS，也不能部署为生产临床服务。接入真实业务前，须先按 PRD 冻结各域 OpenAPI/事件契约、身份认证与操作级授权、数据源适配、数据库迁移、审计和临床签字门禁；未确认的规则不在代码中推断。
