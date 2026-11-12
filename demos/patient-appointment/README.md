# EHR 患者预约 H5

独立 Vue 3 + Vite 患者预约页，可部署到 HIS 子路径或通过 Octop 预览。页面不保存预约、患者或号源数据；仅在内存持有当前响应，并通过 EHR 应用层 API 查询、提交和取消。EHR 患者端接口就绪后，患者登录会话由同源 HIS 服务校验。

## 运行与构建

```powershell
cd demos/patient-appointment/frontend
npm ci
npm run dev
npm test
npm run build        # 生成独立 HIS H5 dist/
npm run build:octop  # 生成 Octop 静态页面
```

复制 `.env.example` 为 `.env.local`。生产环境优先让 HIS 反向代理同源 `/api/v1/patient/*`；需要 API 路径前缀时配置 `VITE_EHR_API_BASE_URL`，该值应为同源路径，患者登录 Cookie 才能随请求发送。`VITE_PATIENT_AGENT_URL` 可选，用于把未命中的单条助手问题转交 HIS AI 服务，不传历史对话。不要把 EHR 员工 token 或服务密钥放进 H5。

## EHR 已有接口与边界

EHR 源码中已存在以下门诊应用接口（Owner 为 `ehr-registration-ds`，由 `ehr-outpatient` 容器装配）：

| 接口                                                   | 用途                         | 当前限制                                           |
| ------------------------------------------------------ | ---------------------------- | -------------------------------------------------- |
| `GET /api/v1/schedules?date&departmentCode&doctorCode` | 查询半日时段号源             | 必须员工会话及挂号/医生工作台角色                  |
| `POST /api/v1/registrations`                           | 挂号，要求 `Idempotency-Key` | 员工角色；请求体接受 `patientId`，不是患者自助身份 |
| `GET /api/v1/registrations`                            | 查询挂号/候诊                | 员工角色；无当前患者范围过滤                       |
| `POST /api/v1/registrations/{no}/cancel`               | 取消挂号                     | 员工角色；不是患者本人取消授权                     |
| `GET/POST /api/v1/patients`                            | 检索/建档                    | 员工角色；建档 `patientId` 由服务端生成，证件查重命中返回 409；不等同于患者登录/患者自助服务 |

患者门户目前仍是应用骨架，`ehr-patient` 也是 MPI 骨架；`ehr-auth` 暴露的是员工认证会话。现有门诊接口虽然可供 EHR 工作台使用，但不能安全地直接开放给患者 H5：不能把员工 token 放进页面，也不能让客户端提交任意患者 ID 查询或挂号。当前未发现已实现的患者自助预约接口。

本机 EHR 服务 `18101/18103/8080/5191` 本轮均未启动，因此无法从运行中的 OpenAPI 或业务 API 读取数据、验证登录态或创建排班/患者记录。没有调用数据库，也没有生成假 EHR 记录。

## 本 H5 使用的自有数据格式

EHR DTO 进入前端后立即映射为轻量页面模型，不把后端 `OpdPatient` / `OpdRegistration` 原样传到视图：

- 号源：`{ id, department: { code, name }, clinician: { code, name }, visitDate, period, remaining, state }`
- 预约：`{ id, slotId, department, clinician, visitDate, period, status, createdAt }`
- 不保存 `patientId`、患者姓名、员工账号、总容量或已挂人数；患者身份来自已认证的 EHR 会话。
- `AM` / `PM` 映射为上午 / 下午。现有 EHR 号源按“医生 + 日期 + 半天”建模，所以页面不虚构分钟级时间。

适配与映射在 `frontend/src/ehrAppointmentApi.mjs`；状态只存在 Vue 内存，刷新会重新读 EHR，不使用 LocalStorage、IndexedDB 或 Octop 数据表。

## 需要 EHR 补充的患者应用接口

建议由挂号业务 Owner 在应用层契约中新增患者范围 API；服务端从患者认证会话取 patient identity，不接受客户端传入 `patientId`：

1. `GET /api/v1/patient/appointment-slots?fromDate&toDate&departmentCode&doctorCode`：返回当前开放的半日号源，字段包含 `slotId`、科室/医生编码与名称、日期、`period`、`remainingSeats`、`status`；不返回 `createdBy` 等审计字段。
2. `POST /api/v1/patient/appointments`，`Idempotency-Key` 请求头，JSON `{ "slotId": "..." }`：从认证会话绑定患者、原子核验并扣减名额，再创建预约；返回患者可见 DTO。
3. `GET /api/v1/patient/appointments`：只返回认证患者本人的预约记录。
4. `POST /api/v1/patient/appointments/{appointmentNo}/cancel`：只允许本人取消可取消状态的预约，服务端做状态 CAS 并释放名额；重复请求应幂等。

成功响应沿用 EHR `ApiResult<T>`（`{ code: "OK", data: ... }`）；号源被抢完返回 `409`，未认证返回 `401`，不可取消/无权访问返回适当的 `403/404/409`。必须配置患者登录或绑定会话、患者范围授权、限流和审计。现有 `/api/v1/schedules` 等员工端接口不应作为这些缺口的临时替代。

在上述接口实现并启动前，H5 会显示接口错误和重试入口，不会回退到虚构数据，也不会假报预约成功。

## 预约助手

助手仍按“FAQ 类别缓存 → 确定性规则 → 本地相似短语检索 → HIS AI 服务”处理；未命中时才请求 `VITE_PATIENT_AGENT_URL`。缓存只保留通用 FAQ 类别，不含患者输入。助手不能替患者选择号源，也不能声称没有得到 EHR 成功结果的预约已经完成。

Octop Agent 安全指令模板位于 `agent/skills/patient-appointment/SKILL.md`；真实预约工具必须由 EHR/HIS 服务配置并进行患者范围授权。
