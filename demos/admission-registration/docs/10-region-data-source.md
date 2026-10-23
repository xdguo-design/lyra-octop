# 地区数据来源

`contracts/regions.mock.json` 是地区选择和语音候选映射的权威数据。它包含中国大陆 31 个省级单位及香港、澳门的区县级节点，不含台湾；不覆盖乡镇、街道、社区或门牌号。

## 来源与许可

- 项目：[`uiwjs/province-city-china`](https://github.com/uiwjs/province-city-china)
- 原始文件：[`level.json`（固定快照）](https://raw.githubusercontent.com/uiwjs/province-city-china/547ade93bc913de0c937200d4fa218d05c0ba97b/level.json)
- Git commit：`547ade93bc913de0c937200d4fa218d05c0ba97b`
- 原始文件 SHA-256：`56cc63e475d2851315d2ff68ea97aee8b67956352093db406db36a2e76cfb43`
- 许可：MIT，版权归原项目 `wabg`（2019）所有；完整条款已保存在 `docs/regions-data-MIT-LICENSE.txt`，并随 Octop wheel 打包在 `src/octop/infra/admission_registration_regions.LICENSE.md`。

本仓库保留上游 `code` 与实际父子层级，把 `name` 转为 `label`，并移除其他上游元数据字段及没有县市节点的台湾空节点。上游数据按 MIT 许可使用；分发时同时保留上游许可声明。

## 维护规则

- `regions.mock.json` 与 `src/octop/infra/admission_registration_regions.json` 必须保持一致：前者供独立 Demo 前后端共同读取，后者供 Octop 安装包中的认证 API 使用。
- 不添加虚拟“市辖区”节点或伪造代码。末级可选路径为省级到区县的 2 段或 3 段，验证必须检查每一段的真实父子关系并确保最后一段是叶节点。
- 更新数据时固定新的上游 commit，记录原始 JSON 的 SHA-256，再同步两份转换数据并运行入院登记 Demo 与 Octop 地区回归测试。
