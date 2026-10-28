# PPT 制作工作台

PPT 制作工作台位于 Octop「创作」页，使用当前选择的、由当前用户拥有的专家及其模型。作品按账号和专家隔离保存在 Octop 数据库设置存储中；逐页生成的 SVG 与 PPTX 放在该专家的工作区。

## 使用

1. 登录 Octop，在「创作」中打开「PPT 制作工作台」。
2. 选择一个自己拥有的专家，填写标题、资料、受众、页数和版式后创建作品。
3. 生成大纲并逐页检查；编辑文字后保存，或在右侧输入指令只修改当前页。
4. 生成全部页面并预览；确认后导出并下载 `.pptx`。

模型输出、对话记录和每页进度会自动保存。作品创建前的讨论也会按当前用户和专家保存；创建作品后，这段对话会并入作品记录。离开后重新打开工作台可继续上下文。大纲格式或页面 SVG 校验失败时会自动重试一次；仍不符合要求时会显示对应阶段的错误。遇到网络或模型错误时，对话和已完成页面会保留；修复问题后可重试未完成页面。修改页面文字或版式会清除受影响页面的旧预览，避免导出内容与编辑内容不一致。

## 部署

在 Octop 项目环境中安装固定版本的 PPT Master 运行时：

```powershell
uv run python scripts/install_ppt_master.py
```

安装器将从固定上游提交下载完整 `ppt-master` 技能包，验证归档 SHA-256 和包内归属声明，再原子安装到 Octop 数据目录 `runtimes/ppt-master/0396656f4f5c28ba8096e8339716c338a576996c/`。无需额外服务或数据库迁移。运行时路径可用 `OCTOP_PPT_MASTER_DIR` 覆盖；覆盖目录应指向 `skills/ppt-master`。

检查接口：

```text
GET /api/agents/{agent_id}/presentations/runtime
```

返回 `installed: true` 且运行版本为 `6.7.3` 后，工作台即可导出 PPTX。若运行时未安装，大纲和页面生成仍可使用，导出接口会明确返回未就绪状态。

## 验证

```powershell
uv run pytest tests/unit/presentations -q
uv run pytest tests/integration/test_presentations_api.py -q
cd dashboard
npm test -- --run src/pages/PresentationStudio/index.test.tsx src/api/modules/presentations.test.ts
npx tsc -b
npm run build
```

当前任务验证了上述后端和前端定向用例、类型检查及真实 PPTX 导出。模型生成需要可用的专家模型凭据，未提供模型凭据时无法验证真实模型内容质量。
