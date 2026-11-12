/* 门诊挂号登记 · V2 目标参考实现（展示用）。全部 PROPOSED：基于挂号模型整理的可落地参考，不冒充现网源码。 */
(function(){
  'use strict';
  window.CLINIC_REG_V2_REFERENCE = {
    version: '2026.09.28',
    status: 'PROPOSED',
    notice: '目标参考实现：包含可执行的控制流、类型、异常与边界接口；接口地址和院区差异以 V2 仓库为准。',
    groups: {
      regist: {
        title: '挂号提交链',
        methodIds: ['M_REGIST_PIPELINE', 'M_VALIDATE_REGIST_INPUT', 'M_RESERVE_SCHEDULE', 'M_SETTLE_REG_FEE'],
        layers: {
          hook: {
            path: 'src/features/outpatient-regist/useRegistSubmit.ts',
            language: 'ts',
            code: [
              "import { useCallback, useState } from 'react';",
              "import { validateRegistInput } from './validateRegistInput';",
              "import { reserveSchedule } from './scheduleService';",
              "import { settleRegFee } from './settleService';",
              "",
              "export function useRegistSubmit() {",
              "  const [submitting, setSubmitting] = useState(false);",
              "  const submit = useCallback(async (form: RegistForm) => {",
              "    setSubmitting(true);",
              "    try {",
              "      const input = validateRegistInput(form);   // 校验：患者/费别/号源",
              "      const schedule = await reserveSchedule(input.scheduleId); // 占号",
              "      return await settleRegFee(input, schedule); // 结算（现金/账户/三方）",
              "    } finally {",
              "      setSubmitting(false);",
              "    }",
              "  }, []);",
              "  return { submit, submitting };",
              "}"
            ]
          },
          service: {
            path: 'src/features/outpatient-regist/settleService.ts',
            language: 'ts',
            code: [
              "import { http } from '@/lib/http';",
              "import type { RegistInput, Schedule, SettleResult } from './types';",
              "",
              "export async function settleRegFee(input: RegistInput, schedule: Schedule): Promise<SettleResult> {",
              "  const res = await http.post('/v2/regist-settle', {",
              "    patMiCode: input.patMiCode,",
              "    scheduleId: schedule.id,",
              "    feeType: input.feeType,",
              "    payWay: input.payWay",
              "  });",
              "  if (res.pendingAmount > 0) {",
              "    // 账户余额不足：返回待支付差额，由 UI 引导充值补差（对齐 020 czbc 分支）",
              "    return { status: 'NEED_RECHARGE', pendingAmount: res.pendingAmount };",
              "  }",
              "  return { status: 'SETTLED', visitCode: res.visitCode };",
              "}"
            ]
          }
        }
      },
      patient: {
        title: '患者识别链',
        methodIds: ['M_PAT_IDENTIFY', 'M_QUERY_PAT_BY_CARD'],
        layers: {
          service: {
            path: 'src/features/outpatient-regist/patientService.ts',
            language: 'ts',
            code: [
              "import { http } from '@/lib/http';",
              "",
              "export type CredentialKind = 'ID_CARD' | 'MI_CARD' | 'ECERT' | 'CARD_NO';",
              "",
              "export function detectCredential(raw: string): CredentialKind {",
              "  if (/^\\d{17}[\\dXx]$/.test(raw)) return 'ID_CARD';",
              "  if (raw.length === 15 || raw.length === 18) return 'CARD_NO'; // 对齐 003 长度分支",
              "  return 'ECERT';",
              "}",
              "",
              "export async function queryPatByCard(query: { type: string; code: string }) {",
              "  return http.get<PatientIdentity[]>('/v2/patients/by-card', {",
              "    ...query,",
              "    statusCode: 'ACTIVE' // 对齐 020 queryByCardType 语义",
              "  });",
              "}"
            ]
          }
        }
      }
    }
  };
})();
