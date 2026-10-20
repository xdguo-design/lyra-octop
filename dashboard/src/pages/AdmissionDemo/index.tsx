import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Checkbox, Input, Modal, Select } from "antd";
import {
  ALargeSmall,
  ArrowRight,
  BedDouble,
  CalendarDays,
  Check,
  CheckCircle2,
  CircleHelp,
  CreditCard,
  FileText,
  Globe,
  HeartPulse,
  Hospital,
  House,
  MapPin,
  MessageCircle,
  MessageSquareText,
  Mic,
  Phone,
  Printer,
  RefreshCw,
  ScanFace,
  ScanLine,
  ShieldCheck,
  Square,
  Stethoscope,
  UserRound,
  UsersRound,
  Volume2,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { admissionDemoApi } from "../../api/modules/admissionDemo";
import { useVoiceOutputContext } from "../../context/VoiceOutputContext";
import { prefetchVoiceConfig } from "../../hooks/useVoiceConfig";
import { useVoiceInput } from "../../hooks/useVoiceInput";
import {
  firstMissingRequired,
  isValidAdmissionField,
  mergeCandidates,
  mockHisSubmit,
  type AdmissionFieldName,
  type AdmissionFields,
} from "./flow";
import "./index.css";

type Stage =
  | "identity"
  | "querying"
  | "application"
  | "details"
  | "fees"
  | "submitted";
type IdentityMethod = "id-card" | "health-card" | "qr" | "face";

/** Fictional demo data — mirrors the prototype storyboard. */
const APPLICATION = {
  patient: "张三",
  maskedId: "110***********1234",
  applicationId: "RY202610160018",
  department: "呼吸内科",
  doctor: "李主任医师",
  date: "2026-10-16",
  dateWithWeek: "2026-10-16（周五）",
  ward: "呼吸内科一病区",
  bed: "8床",
  phone: "13800005678",
  maskedPhone: "138****5678",
  diagnosis: "肺部感染 / 慢阻肺急性加重",
  source: "门诊",
};

const fieldLabels: Record<AdmissionFieldName, string> = {
  contact_name: "admissionDemo.fields.contact_name",
  relationship: "admissionDemo.fields.relationship",
  contact_phone: "admissionDemo.fields.contact_phone",
  address: "admissionDemo.fields.address",
  emergency_contact: "admissionDemo.fields.emergency_contact",
  emergency_phone: "admissionDemo.fields.emergency_phone",
};
const fieldNameKeys: Record<AdmissionFieldName, string> = {
  contact_name: "admissionDemo.fieldNames.contact_name",
  relationship: "admissionDemo.fieldNames.relationship",
  contact_phone: "admissionDemo.fieldNames.contact_phone",
  address: "admissionDemo.fieldNames.address",
  emergency_contact: "admissionDemo.fieldNames.emergency_contact",
  emergency_phone: "admissionDemo.fieldNames.emergency_phone",
};

const RELATIONSHIP_OPTIONS = [
  "relationshipOptionSpouse",
  "relationshipOptionSon",
  "relationshipOptionDaughter",
  "relationshipOptionParents",
  "relationshipOptionSiblings",
  "relationshipOptionOther",
];

function questionFor(
  field: AdmissionFieldName | null,
  t: ReturnType<typeof useTranslation>["t"],
) {
  return field
    ? t("admissionDemo.question", { field: t(fieldNameKeys[field]) })
    : t("admissionDemo.reviewDetails");
}

function speechSafeText(
  text: string,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  return text.replace(/\b1\d{10}\b/g, (phone) =>
    t("admissionDemo.phoneSpokenSuffix", { digits: phone.slice(-4) }),
  );
}

function formatKioskClock(date: Date, language: string) {
  const locale = language.startsWith("zh") ? "zh-CN" : "en-US";
  const day = language.startsWith("zh")
    ? `${new Intl.DateTimeFormat(locale, { year: "numeric" }).format(
        date,
      )}${new Intl.DateTimeFormat(locale, { month: "2-digit" }).format(
        date,
      )}${new Intl.DateTimeFormat(locale, { day: "numeric" }).format(
        date,
      )} ${new Intl.DateTimeFormat(locale, { weekday: "long" }).format(date)}`
    : new Intl.DateTimeFormat(locale, {
        year: "numeric",
        month: "short",
        day: "numeric",
        weekday: "long",
      }).format(date);
  const time = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return { day, time };
}

function formatRecordingTime(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(
    seconds % 60,
  ).padStart(2, "0")}`;
}

export default function AdmissionDemoPage() {
  const { t, i18n } = useTranslation();
  const viewportRef = useRef<HTMLDivElement>(null);
  const [canvasScale, setCanvasScale] = useState(1);
  prefetchVoiceConfig();
  const voiceOutput = useVoiceOutputContext();
  const stopVoice = voiceOutput.stop;
  const voiceWaveLeftRef = useRef<HTMLDivElement>(null);
  const voiceStartStageRef = useRef<Stage>("identity");
  const [voiceDetected, setVoiceDetected] = useState(false);
  const [voiceLevelAvailable, setVoiceLevelAvailable] = useState(false);
  const [voiceElapsedSeconds, setVoiceElapsedSeconds] = useState(0);
  const voiceStartedAtRef = useRef(0);
  const [stage, setStage] = useState<Stage>("identity");
  const [identityMethod, setIdentityMethod] =
    useState<IdentityMethod>("id-card");
  const [smsFallback, setSmsFallback] = useState(false);
  const [supportNotice, setSupportNotice] = useState("");
  const [fields, setFields] = useState<AdmissionFields>({});
  const [mobile, setMobile] = useState("");
  const [code, setCode] = useState("");
  const [smsSent, setSmsSent] = useState(false);
  const [draft, setDraft] = useState("");
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [insuranceAcknowledged, setInsuranceAcknowledged] = useState(false);
  const [feesAcknowledged, setFeesAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState("");
  const [handledAt, setHandledAt] = useState("");
  const [manualInputOpen, setManualInputOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const resizeCanvas = () => {
      const width = viewport.clientWidth || window.innerWidth;
      const height = viewport.clientHeight || window.innerHeight;
      setCanvasScale(Math.min(width / 1536, height / 1024, 1));
    };
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    return () => window.removeEventListener("resize", resizeCanvas);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 15000);
    return () => window.clearInterval(timer);
  }, []);

  const voiceInput = useVoiceInput({
    onStart: () => {
      stopVoice();
      voiceStartStageRef.current = stage;
      voiceStartedAtRef.current = Date.now();
      setVoiceElapsedSeconds(0);
      setVoiceLevelAvailable(false);
      setVoiceDetected(false);
      setVoiceTranscript("");
      setError("");
    },
    onInterim: setDraft,
    onLevel: (level) => {
      if (level > 0.006) setVoiceLevelAvailable(true);
      if (level > 0.06) setVoiceDetected(true);
      const scale = String(0.42 + Math.min(0.8, level * 2));
      voiceWaveLeftRef.current?.style.setProperty("--voice-wave-scale", scale);
    },
    onText: (text) => {
      const transcript = text.trim();
      if (!transcript) return;
      setVoiceTranscript(transcript);
      setDraft(transcript);
      if (voiceStartStageRef.current === "details" && stage === "details") {
        void sendMessage(transcript);
      }
    },
  });

  useEffect(() => {
    if (!voiceInput.recording) return;
    if (!voiceStartedAtRef.current) voiceStartedAtRef.current = Date.now();
    const updateElapsed = () => {
      setVoiceElapsedSeconds(
        Math.floor((Date.now() - voiceStartedAtRef.current) / 1000),
      );
    };
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 250);
    return () => window.clearInterval(timer);
  }, [voiceInput.recording]);

  useEffect(() => () => stopVoice(), [stopVoice]);

  useEffect(() => {
    if (stage !== "querying") return;
    const timer = window.setTimeout(() => setStage("application"), 2200);
    return () => window.clearTimeout(timer);
  }, [stage]);

  const missingField = useMemo(() => firstMissingRequired(fields), [fields]);
  const clock = formatKioskClock(now, i18n.language || "zh");
  const stepLabels = [
    t("admissionDemo.steps.identity"),
    t("admissionDemo.steps.application"),
    t("admissionDemo.steps.details"),
    t("admissionDemo.steps.fees"),
    t("admissionDemo.steps.complete"),
  ];
  const stepHints = [
    t("admissionDemo.stepHints.identity"),
    t("admissionDemo.stepHints.application"),
    t("admissionDemo.stepHints.details"),
    t("admissionDemo.stepHints.fees"),
    t("admissionDemo.stepHints.complete"),
  ];
  const stepIcons = [
    CreditCard,
    ShieldCheck,
    UsersRound,
    HeartPulse,
    CheckCircle2,
  ];
  const identityMethods = [
    { id: "id-card" as const, label: "idCard", icon: CreditCard },
    { id: "health-card" as const, label: "healthCard", icon: HeartPulse },
    { id: "qr" as const, label: "qrIdentify", icon: ScanLine },
    { id: "face" as const, label: "faceIdentify", icon: ScanFace },
  ];
  const speakAssistant = (text: string) => {
    voiceOutput.speak(`admission-${Date.now()}`, speechSafeText(text, t));
  };

  const verifyIdentity = () => {
    setError("");
    setSmsFallback(false);
    setFields({ contact_phone: APPLICATION.phone });
    setStage("querying");
  };

  const toggleVoiceEntry = () => {
    voiceInput.toggle();
  };

  const sendSms = () => {
    if (mobile.trim() !== APPLICATION.phone) {
      setError(t("admissionDemo.invalidVerification"));
      return;
    }
    setSmsSent(true);
    setError("");
  };

  const verifySms = () => {
    if (
      !smsSent ||
      mobile.trim() !== APPLICATION.phone ||
      code.trim() !== "123456"
    ) {
      setError(t("admissionDemo.invalidVerification"));
      return;
    }
    verifyIdentity();
  };

  const confirmApplication = () => {
    setError("");
    setStage("details");
    const greeting = t("admissionDemo.chatGreeting");
    const question = questionFor(firstMissingRequired(fields), t);
    speakAssistant(`${greeting} ${question}`);
  };

  const readApplication = () => {
    speakAssistant(
      [
        `${t("admissionDemo.applicationLabel")}：${APPLICATION.applicationId}`,
        `${t("admissionDemo.patientNameLabel")}：${APPLICATION.patient}`,
        `${t("admissionDemo.departmentLabel")}：${APPLICATION.department}`,
        `${t("admissionDemo.applicationDoctorLabel")}：${APPLICATION.doctor}`,
        `${t("admissionDemo.applicationDateLabel")}：${APPLICATION.date}`,
        `${t("admissionDemo.admissionType")}：${t(
          "admissionDemo.admissionTypeValue",
        )}`,
        `${t("admissionDemo.suggestWardLabel")}：${APPLICATION.ward}`,
        `${t("admissionDemo.diagnosisLabel")}：${APPLICATION.diagnosis}`,
        `${t("admissionDemo.sourceLabel")}：${APPLICATION.source}`,
        `${t("admissionDemo.insurance")}：${t("admissionDemo.insuranceValue")}`,
        `${t("admissionDemo.statusLabel")}：${t(
          "admissionDemo.awaitingConfirmation",
        )}`,
      ].join("。"),
    );
  };

  const sendMessage = async (textOverride?: string) => {
    const text = (textOverride ?? draft).trim();
    if (!text || pending) return;
    setDraft("");
    setError("");
    setPending(true);
    try {
      const response = await admissionDemoApi.extract(text);
      const next = mergeCandidates(fields, response.fields, text);
      setFields(next);
      const extracted = Object.entries(response.fields)
        .filter(
          ([key]) =>
            (
              [
                "emergency_contact",
                "emergency_phone",
                "relationship",
                "address",
              ] as string[]
            ).includes(key) && Boolean(next[key as AdmissionFieldName]),
        )
        .map(
          ([key]) =>
            `${t(fieldLabels[key as AdmissionFieldName])}：${
              next[key as AdmissionFieldName]
            }`,
        )
        .join("；");
      if (!extracted) {
        setError(t("admissionDemo.modelFailure"));
        speakAssistant(t("admissionDemo.modelFailure"));
      } else {
        const answer = t("admissionDemo.extracted", { fields: extracted });
        const question = questionFor(firstMissingRequired(next), t);
        speakAssistant(`${answer} ${question}`);
      }
    } catch {
      setError(t("admissionDemo.modelFailure"));
      speakAssistant(t("admissionDemo.modelFailure"));
    } finally {
      setPending(false);
    }
  };

  const updateField = (field: AdmissionFieldName, value: string) => {
    setFields((current) => ({ ...current, [field]: value }));
  };

  const confirmDetails = () => {
    if (missingField) {
      setError(t("admissionDemo.missingDetails"));
      return;
    }
    setError("");
    setStage("fees");
  };

  const submit = async () => {
    if (
      !insuranceAcknowledged ||
      !feesAcknowledged ||
      submitting ||
      stage !== "fees"
    )
      return;
    setSubmitting(true);
    setError("");
    await new Promise((resolve) => window.setTimeout(resolve, 300));
    const result = mockHisSubmit(APPLICATION.applicationId);
    setReceipt(result.receiptId);
    setHandledAt(
      formatKioskClock(new Date(), "zh-CN").day +
        " " +
        formatKioskClock(new Date(), "zh-CN").time,
    );
    setSubmitting(false);
    setStage("submitted");
    speakAssistant(
      `${t("admissionDemo.heroSuccessGreeting")} ${t(
        "admissionDemo.heroSuccessMessage",
      )}`,
    );
  };

  const restart = () => {
    stopVoice();
    setStage("identity");
    setIdentityMethod("id-card");
    setSmsFallback(false);
    setSupportNotice("");
    setFields({});
    setMobile("");
    setCode("");
    setSmsSent(false);
    setDraft("");
    setVoiceTranscript("");
    setError("");
    setPending(false);
    setInsuranceAcknowledged(false);
    setFeesAcknowledged(false);
    setSubmitting(false);
    setReceipt("");
    setHandledAt("");
    setManualInputOpen(false);
  };

  const stepIndex =
    stage === "identity"
      ? 0
      : stage === "application" || stage === "querying"
      ? 1
      : stage === "details"
      ? 2
      : stage === "fees"
      ? 3
      : 4;

  const heroKey =
    stage === "querying"
      ? "Query"
      : stage === "application"
      ? "Application"
      : stage === "details"
      ? "Details"
      : stage === "fees"
      ? "Fees"
      : stage === "submitted"
      ? "Success"
      : "";

  const voiceCopy: Record<Stage, { title: string; sub: string }> = {
    identity: {
      title: t("admissionDemo.voiceInput"),
      sub: t("admissionDemo.voiceSubtitleGeneric"),
    },
    querying: {
      title: t("admissionDemo.voiceProcessing"),
      sub: t("admissionDemo.voiceProcessingSub"),
    },
    application: {
      title: t("admissionDemo.voiceInput"),
      sub: t("admissionDemo.voiceSubtitleGeneric"),
    },
    details: {
      title: t("admissionDemo.voiceInput"),
      sub: t("admissionDemo.detailsVoiceSubtitle"),
    },
    fees: {
      title: t("admissionDemo.voiceInput"),
      sub: t("admissionDemo.voiceSubtitleGeneric"),
    },
    submitted: {
      title: t("admissionDemo.voiceInput"),
      sub: t("admissionDemo.voiceSubtitleGeneric"),
    },
  };

  const quickChips: Record<Stage, { label: string; run: () => void }[]> = {
    identity: [
      {
        label: t("admissionDemo.chipIdentityOne"),
        run: () => speakAssistant(t("admissionDemo.identityVoiceGuide")),
      },
      {
        label: t("admissionDemo.chipIdentityTwo"),
        run: () => setIdentityMethod("health-card"),
      },
      {
        label: t("admissionDemo.chipHelp"),
        run: () => setSupportNotice(t("admissionDemo.helpUnavailable")),
      },
    ],
    querying: [
      {
        label: t("admissionDemo.chipQueryingOne"),
        run: () => speakAssistant(t("admissionDemo.queryVoiceGuide")),
      },
      {
        label: t("admissionDemo.chipQueryingTwo"),
        run: () => speakAssistant(t("admissionDemo.queryPrepareGuide")),
      },
      {
        label: t("admissionDemo.chipHelp"),
        run: () => setSupportNotice(t("admissionDemo.helpUnavailable")),
      },
    ],
    application: [
      {
        label: t("admissionDemo.chipApplicationOne"),
        run: () => confirmApplication(),
      },
      { label: t("admissionDemo.chipApplicationTwo"), run: () => restart() },
      {
        label: t("admissionDemo.chipApplicationThree"),
        run: () => speakAssistant(t("admissionDemo.applicationVoiceGuide")),
      },
    ],
    details: [
      {
        label: t("admissionDemo.chipDetailsOne"),
        run: () => void sendMessage(t("admissionDemo.suggestionContactName")),
      },
      {
        label: t("admissionDemo.chipDetailsTwo"),
        run: () => void sendMessage(t("admissionDemo.suggestionContactPhone")),
      },
      {
        label: t("admissionDemo.chipDetailsThree"),
        run: () => void sendMessage(t("admissionDemo.suggestionAddress")),
      },
    ],
    fees: [
      {
        label: t("admissionDemo.chipFeesOne"),
        run: () => speakAssistant(t("admissionDemo.feesVoiceGuide")),
      },
      {
        label: t("admissionDemo.chipFeesTwo"),
        run: () => speakAssistant(t("admissionDemo.feesVoiceGuide")),
      },
      {
        label: t("admissionDemo.chipHelp"),
        run: () => setSupportNotice(t("admissionDemo.helpUnavailable")),
      },
    ],
    submitted: [
      {
        label: t("admissionDemo.chipSubmittedOne"),
        run: () => setSupportNotice(t("admissionDemo.wardDemoHint")),
      },
      {
        label: t("admissionDemo.chipSubmittedTwo"),
        run: () => setSupportNotice(t("admissionDemo.printDemoHint")),
      },
      {
        label: t("admissionDemo.chipHelp"),
        run: () => setSupportNotice(t("admissionDemo.helpUnavailable")),
      },
    ],
  };

  const detailRows: {
    field: AdmissionFieldName;
    icon: typeof Phone;
    required: boolean;
    select?: boolean;
  }[] = [
    { field: "contact_phone", icon: Phone, required: false },
    { field: "emergency_contact", icon: UserRound, required: true },
    { field: "emergency_phone", icon: Phone, required: true },
    { field: "relationship", icon: UsersRound, required: true, select: true },
    { field: "address", icon: MapPin, required: true },
  ];

  const patientRows = () => {
    if (stage === "querying") {
      return (
        <>
          <div>
            <span>{t("admissionDemo.insurance")}</span>
            <strong>{t("admissionDemo.insuranceValue")}</strong>
          </div>
          <div>
            <span>{t("admissionDemo.livingAddress")}</span>
            <strong>{t("admissionDemo.maskedAddress")}</strong>
          </div>
          <div>
            <span>{t("admissionDemo.admissionArranged")}</span>
            <strong className="loading">
              <span className="admission-mini-spinner" />
              {t("admissionDemo.searchingInline")}
            </strong>
          </div>
        </>
      );
    }
    if (stage === "application") {
      return (
        <>
          <div>
            <span>{t("admissionDemo.genderLabel")}</span>
            <strong>{t("admissionDemo.genderValue")}</strong>
          </div>
          <div>
            <span>{t("admissionDemo.ageLabel")}</span>
            <strong>{t("admissionDemo.ageValue")}</strong>
          </div>
          <div>
            <span>{t("admissionDemo.mobileNumberLabel")}</span>
            <strong>{APPLICATION.maskedPhone}</strong>
          </div>
          <div>
            <span>{t("admissionDemo.idNumberLabel")}</span>
            <strong>{APPLICATION.maskedId}</strong>
          </div>
        </>
      );
    }
    if (stage === "details") {
      return (
        <>
          <div>
            <span>{t("admissionDemo.inpatientDeptLabel")}</span>
            <strong>{APPLICATION.department}</strong>
          </div>
          <div>
            <span>{t("admissionDemo.bedInfoLabel")}</span>
            <strong>
              {APPLICATION.ward} {APPLICATION.bed}
            </strong>
          </div>
          <div>
            <span>{t("admissionDemo.insurance")}</span>
            <strong>{t("admissionDemo.insuranceValue")}</strong>
          </div>
          <div>
            <span>{t("admissionDemo.emergencyContactLabel")}</span>
            <strong className={fields.emergency_contact ? "" : "missing"}>
              {fields.emergency_contact || t("admissionDemo.pendingFill")}
            </strong>
          </div>
          <div>
            <span>{t("admissionDemo.emergencyPhoneLabel")}</span>
            <strong className={fields.emergency_phone ? "" : "missing"}>
              {fields.emergency_phone || t("admissionDemo.pendingFill")}
            </strong>
          </div>
          <div>
            <span>{t("admissionDemo.livingAddress")}</span>
            <strong className={fields.address ? "" : "missing"}>
              {fields.address || t("admissionDemo.pendingFill")}
            </strong>
          </div>
        </>
      );
    }
    return (
      <>
        <div>
          <span>{t("admissionDemo.insurance")}</span>
          <strong>{t("admissionDemo.insuranceValue")}</strong>
        </div>
        <div>
          <span>{t("admissionDemo.livingAddress")}</span>
          <strong>{fields.address || t("admissionDemo.maskedAddress")}</strong>
        </div>
        <div>
          <span>{t("admissionDemo.emergencyContactLabel")}</span>
          <strong>
            {fields.emergency_contact || t("admissionDemo.pendingFill")}
            {fields.relationship ? `（${fields.relationship}）` : ""}
          </strong>
        </div>
        <div>
          <span>{t("admissionDemo.emergencyPhoneLabel")}</span>
          <strong>
            {fields.emergency_phone || t("admissionDemo.pendingFill")}
          </strong>
        </div>
        <div className="stacked">
          <span>{t("admissionDemo.admissionArranged")}</span>
          <strong className="confirmed">
            <CheckCircle2 size={17} />
            {t("admissionDemo.admissionConfirmedValue")}
          </strong>
          <small>
            {t("admissionDemo.wardBedLine", {
              ward: APPLICATION.ward,
              bed: APPLICATION.bed,
            })}
          </small>
          <small>
            {t("admissionDemo.admissionTimeLine", { date: APPLICATION.date })}
          </small>
        </div>
      </>
    );
  };

  return (
    <div className="admission-demo">
      <div className="admission-demo-stage" ref={viewportRef}>
        <div
          className="admission-kiosk-canvas"
          style={{ transform: `translate(-50%, -50%) scale(${canvasScale})` }}
        >
          <header className="admission-header">
            <div className="admission-brand">
              <span className="admission-brand-mark">+</span>
              <span>
                <strong>{t("admissionDemo.kioskHospital")}</strong>
                <small>{t("admissionDemo.kioskTerminal")}</small>
              </span>
            </div>
            <nav
              className="admission-kiosk-nav"
              aria-label={t("admissionDemo.kioskNavigation")}
            >
              <div className="active">
                <span>
                  <CreditCard size={26} />
                </span>
                <span>
                  {t("admissionDemo.kioskRegistration")}
                  <small>{t("admissionDemo.kioskRegistrationHint")}</small>
                </span>
              </div>
              <div>
                <span>
                  <ShieldCheck size={26} />
                </span>
                <span>
                  {t("admissionDemo.kioskAdmission")}
                  <small>{t("admissionDemo.kioskAdmissionHint")}</small>
                </span>
              </div>
              <div>
                <span>
                  <HeartPulse size={26} />
                </span>
                <span>
                  {t("admissionDemo.kioskOtherServices")}
                  <small>{t("admissionDemo.kioskOtherServicesHint")}</small>
                </span>
              </div>
            </nav>
            <div className="admission-header-meta">
              <p className="admission-clock">
                {clock.day}
                <i />
                <b>{clock.time}</b>
              </p>
              <div className="admission-header-tools" aria-label="终端显示设置">
                <span>
                  <Globe size={15} />
                  {t("admissionDemo.langChinese")}
                </span>
                <span>
                  <ALargeSmall size={16} />
                  {t("admissionDemo.largeFont")}
                </span>
                <span>
                  <CircleHelp size={15} />
                  {t("admissionDemo.helpLabel")}
                </span>
              </div>
            </div>
          </header>
          <main className="admission-main">
            <aside className="admission-rail">
              <h2>{t("admissionDemo.kioskWorkflow")}</h2>
              <div className="admission-steps">
                {stepLabels.map((label, index) => (
                  <div
                    className={`admission-step${
                      index < stepIndex
                        ? " done"
                        : index === stepIndex
                        ? " active"
                        : ""
                    }`}
                    key={label}
                    aria-current={index === stepIndex ? "step" : undefined}
                  >
                    <span className="admission-step-icon">
                      {(() => {
                        const Icon = stepIcons[index];
                        return <Icon size={30} />;
                      })()}
                    </span>
                    <span className="admission-step-number">{index + 1}</span>
                    <span className="admission-step-text">
                      <strong>{label}</strong>
                      <small>{stepHints[index]}</small>
                    </span>
                    {index < stepIndex && (
                      <span className="admission-step-check">
                        <Check size={14} strokeWidth={3.4} />
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <div
                className="admission-hospital-illustration"
                aria-hidden="true"
              >
                <img src="/admission-demo/hospital-exterior.png" alt="" />
              </div>
              <p className="admission-rail-motto">
                <HeartPulse size={22} />
                {t("admissionDemo.hospitalMotto")}
              </p>
              <p className="admission-rail-note">
                {t("admissionDemo.securityHint")}
              </p>
            </aside>

            <section className="admission-center">
              <section className="admission-intro">
                <img
                  className="admission-nurse-hero"
                  src="/admission-demo/nurse-hero.png"
                  alt=""
                />
                <div className="admission-welcome-bubble">
                  <h1>{t(`admissionDemo.hero${heroKey}Greeting`)}</h1>
                  <p>{t(`admissionDemo.hero${heroKey}Message`)}</p>
                  <button
                    type="button"
                    aria-label={t("admissionDemo.replayWelcome")}
                    onClick={() =>
                      speakAssistant(t(`admissionDemo.hero${heroKey}Message`))
                    }
                  >
                    <Volume2 size={22} />
                  </button>
                </div>
              </section>
              <section className="admission-card">
                {stage === "identity" && (
                  <div className="admission-stage admission-identity-stage">
                    <div className="admission-stage-heading">
                      <span className="admission-stage-icon">1</span>
                      <div className="admission-stage-heading-copy">
                        <h2>{t("admissionDemo.identityTitle")}</h2>
                        <p>{t("admissionDemo.identityDescription")}</p>
                      </div>
                    </div>
                    {smsFallback ? (
                      <div className="admission-sms-fallback">
                        <h3>{t("admissionDemo.smsTitle")}</h3>
                        <Input
                          value={mobile}
                          onChange={(event) => setMobile(event.target.value)}
                          placeholder={t("admissionDemo.phonePlaceholder")}
                          inputMode="numeric"
                          maxLength={11}
                        />
                        <Button onClick={sendSms}>
                          {t("admissionDemo.sendCode")}
                        </Button>
                        {smsSent && (
                          <>
                            <Input
                              value={code}
                              onChange={(event) => setCode(event.target.value)}
                              placeholder={t("admissionDemo.codePlaceholder")}
                              inputMode="numeric"
                              maxLength={6}
                            />
                            <small className="admission-demo-code">
                              {t("admissionDemo.demoCode")}
                            </small>
                            <Button type="primary" onClick={verifySms}>
                              {t("admissionDemo.verify")}
                            </Button>
                          </>
                        )}
                        {error && (
                          <Alert type="warning" showIcon message={error} />
                        )}
                        <Button
                          className="admission-back-methods"
                          onClick={() => setSmsFallback(false)}
                        >
                          {t("admissionDemo.backToMethods")}
                        </Button>
                      </div>
                    ) : (
                      <>
                        <div
                          className="admission-identification-options"
                          role="group"
                          aria-label={t("admissionDemo.identityMethods")}
                        >
                          {identityMethods.map((method) => {
                            const Icon = method.icon;
                            return (
                              <button
                                className={`admission-identification-card${
                                  identityMethod === method.id
                                    ? " selected"
                                    : ""
                                }`}
                                type="button"
                                aria-pressed={identityMethod === method.id}
                                key={method.id}
                                onClick={() => setIdentityMethod(method.id)}
                              >
                                <span
                                  className={`admission-method-icon method-${method.id}`}
                                  aria-hidden="true"
                                >
                                  {method.id === "id-card" ? (
                                    <span className="admission-method-id-card">
                                      <i />
                                      <span>
                                        <i />
                                        <i />
                                        <i />
                                      </span>
                                    </span>
                                  ) : method.id === "health-card" ? (
                                    <span className="admission-method-health-card">
                                      <HeartPulse size={22} />
                                      <b>{t("admissionDemo.healthCardMark")}</b>
                                    </span>
                                  ) : method.id === "qr" ? (
                                    <span className="admission-method-qr-phone">
                                      <img
                                        src="/admission-demo/demo-qr.svg"
                                        alt=""
                                      />
                                      <i />
                                    </span>
                                  ) : (
                                    <span className="admission-method-face">
                                      <Icon size={36} strokeWidth={1.8} />
                                    </span>
                                  )}
                                </span>
                                <strong>
                                  {t(`admissionDemo.${method.label}`)}
                                </strong>
                                <small>
                                  {t(`admissionDemo.${method.label}Hint`)}
                                </small>
                              </button>
                            );
                          })}
                        </div>
                        <div className="admission-reader-demo">
                          <div
                            className={`admission-reader-visual ${identityMethod}`}
                            aria-hidden="true"
                          >
                            <img src="/admission-demo/reader-demo.png" alt="" />
                          </div>
                          <button
                            type="button"
                            className="admission-reader-slot"
                            aria-label={t("admissionDemo.simulateRecognition")}
                            onClick={verifyIdentity}
                          >
                            <span
                              className="admission-reader-wave"
                              aria-hidden="true"
                            >
                              <i />
                              <i />
                              <i />
                              <i />
                              <i />
                            </span>
                            <strong>{t("admissionDemo.readerTitle")}</strong>
                            <small>{t("admissionDemo.readerLabel")}</small>
                          </button>
                          <div className="admission-reader-tip">
                            <strong>{t("admissionDemo.warmTip")}</strong>
                            <ul>
                              {["one", "two", "three", "four"].map((key) => (
                                <li key={key}>
                                  {t(`admissionDemo.readerTip.${key}`)}
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                        {error && (
                          <Alert type="warning" showIcon message={error} />
                        )}
                      </>
                    )}
                  </div>
                )}

                {stage === "querying" && (
                  <div className="admission-stage admission-query-stage">
                    <div className="admission-stage-heading">
                      <span className="admission-stage-icon">2</span>
                      <div className="admission-stage-heading-copy">
                        <h2>{t("admissionDemo.queryTitle")}</h2>
                      </div>
                      <Button
                        className="admission-voice-guide"
                        icon={<Volume2 size={19} />}
                        onClick={() =>
                          speakAssistant(t("admissionDemo.queryVoiceGuide"))
                        }
                      >
                        {t("admissionDemo.voiceGuide")}
                      </Button>
                    </div>
                    <div className="admission-query-body">
                      <dl className="admission-query-list">
                        <div>
                          <dt>
                            <Hospital size={21} />
                            {t("admissionDemo.departmentLabel")}
                          </dt>
                          <dd>{APPLICATION.department}</dd>
                        </div>
                        <div>
                          <dt>
                            <Stethoscope size={21} />
                            {t("admissionDemo.doctorLabel")}
                          </dt>
                          <dd>{APPLICATION.doctor}</dd>
                        </div>
                        <div>
                          <dt>
                            <CalendarDays size={21} />
                            {t("admissionDemo.planDateLabel")}
                          </dt>
                          <dd>{APPLICATION.dateWithWeek}</dd>
                        </div>
                        <div>
                          <dt>
                            <FileText size={21} />
                            {t("admissionDemo.admissionType")}
                          </dt>
                          <dd>{t("admissionDemo.admissionTypeValue")}</dd>
                        </div>
                        <div>
                          <dt>
                            <BedDouble size={21} />
                            {t("admissionDemo.wardLabel")}
                          </dt>
                          <dd>{APPLICATION.ward}</dd>
                        </div>
                      </dl>
                      <div className="admission-query-status">
                        <div className="complete">
                          <CheckCircle2 size={26} />
                          <span className="admission-status-copy">
                            <strong>
                              {t("admissionDemo.identityVerified")}
                            </strong>
                            <small>{t("admissionDemo.identityRead")}</small>
                          </span>
                        </div>
                        <div className="loading">
                          <span className="admission-spinner" />
                          <span className="admission-status-copy">
                            <strong>
                              {t("admissionDemo.admissionSearching")}
                            </strong>
                            <small>{t("admissionDemo.searchingStatus")}</small>
                          </span>
                        </div>
                        <div className="waiting">
                          <span className="admission-status-empty" />
                          <span className="admission-status-copy">
                            <strong>
                              {t("admissionDemo.qualificationChecking")}
                            </strong>
                            <small>{t("admissionDemo.waitingStatus")}</small>
                          </span>
                        </div>
                        <div className="waiting">
                          <span className="admission-status-empty" />
                          <span className="admission-status-copy">
                            <strong>
                              {t("admissionDemo.insuranceLoading")}
                            </strong>
                            <small>{t("admissionDemo.waitingStatus")}</small>
                          </span>
                        </div>
                      </div>
                    </div>
                    <p className="admission-query-note">
                      {t("admissionDemo.queryHint")}
                    </p>
                  </div>
                )}

                {stage === "application" && (
                  <div className="admission-stage admission-application-stage">
                    <div className="admission-stage-heading">
                      <span className="admission-stage-icon">2</span>
                      <div className="admission-stage-heading-copy">
                        <h2>{t("admissionDemo.applicationTitle")}</h2>
                        <p>{t("admissionDemo.applicationDescription")}</p>
                      </div>
                    </div>
                    <div className="admission-application-layout">
                      <dl className="admission-application-data">
                        <div>
                          <dt>{t("admissionDemo.applicationLabel")}</dt>
                          <dd>{APPLICATION.applicationId}</dd>
                        </div>
                        <div>
                          <dt>{t("admissionDemo.patientNameLabel")}</dt>
                          <dd>{APPLICATION.patient}</dd>
                        </div>
                        <div>
                          <dt>{t("admissionDemo.departmentLabel")}</dt>
                          <dd>{APPLICATION.department}</dd>
                        </div>
                        <div>
                          <dt>{t("admissionDemo.applicationDoctorLabel")}</dt>
                          <dd>{APPLICATION.doctor}</dd>
                        </div>
                        <div>
                          <dt>{t("admissionDemo.applicationDateLabel")}</dt>
                          <dd>{APPLICATION.date}</dd>
                        </div>
                        <div>
                          <dt>{t("admissionDemo.admissionType")}</dt>
                          <dd>{t("admissionDemo.admissionTypeValue")}</dd>
                        </div>
                        <div>
                          <dt>{t("admissionDemo.suggestWardLabel")}</dt>
                          <dd>{APPLICATION.ward}</dd>
                        </div>
                        <div>
                          <dt>{t("admissionDemo.diagnosisLabel")}</dt>
                          <dd>{APPLICATION.diagnosis}</dd>
                        </div>
                        <div>
                          <dt>{t("admissionDemo.sourceLabel")}</dt>
                          <dd>{APPLICATION.source}</dd>
                        </div>
                        <div>
                          <dt>{t("admissionDemo.insurance")}</dt>
                          <dd>{t("admissionDemo.insuranceValue")}</dd>
                        </div>
                        <div>
                          <dt>{t("admissionDemo.statusLabel")}</dt>
                          <dd>
                            <span className="admission-status-pending">
                              {t("admissionDemo.awaitingConfirmation")}
                            </span>
                          </dd>
                        </div>
                      </dl>
                      <aside className="admission-application-side">
                        <div className="admission-application-progress">
                          <div className="done">
                            <CheckCircle2 size={22} />
                            <span className="admission-status-copy">
                              <strong>
                                {t("admissionDemo.identityVerified")}
                              </strong>
                              <small>
                                {t("admissionDemo.identityGotHint")}
                              </small>
                            </span>
                          </div>
                          <div className="done">
                            <CheckCircle2 size={22} />
                            <span className="admission-status-copy">
                              <strong>
                                {t("admissionDemo.applicationReceived")}
                              </strong>
                              <small>
                                {t("admissionDemo.applicationReceivedHint")}
                              </small>
                            </span>
                          </div>
                          <div className="current">
                            <span className="admission-info-mark">i</span>
                            <span className="admission-status-copy">
                              <strong>
                                {t("admissionDemo.waitingPatient")}
                              </strong>
                              <small>
                                {t("admissionDemo.checkBeforeConfirm")}
                              </small>
                            </span>
                          </div>
                        </div>
                        <div className="admission-application-warning">
                          <strong>{t("admissionDemo.warmTip")}</strong>
                          <p>{t("admissionDemo.applicationWarning")}</p>
                        </div>
                      </aside>
                    </div>
                    {error && (
                      <Alert
                        className="admission-error"
                        type="warning"
                        showIcon
                        message={error}
                      />
                    )}
                    <div className="admission-application-actions">
                      <Button
                        type="primary"
                        icon={<CheckCircle2 size={19} />}
                        onClick={confirmApplication}
                      >
                        {t("admissionDemo.isPatient")}
                      </Button>
                      <Button icon={<X size={19} />} onClick={restart}>
                        {t("admissionDemo.notPatient")}
                      </Button>
                      <Button
                        icon={<Volume2 size={19} />}
                        onClick={readApplication}
                      >
                        {t("admissionDemo.readApplication")}
                      </Button>
                    </div>
                  </div>
                )}

                {stage === "details" && (
                  <div className="admission-stage admission-details-stage">
                    <div className="admission-stage-heading">
                      <span className="admission-stage-icon">3</span>
                      <div className="admission-stage-heading-copy">
                        <h2>{t("admissionDemo.detailsTitle")}</h2>
                        <p>{t("admissionDemo.detailsDescription")}</p>
                      </div>
                    </div>
                    <div className="admission-details-layout">
                      <div className="admission-form-fields">
                        {detailRows.map((row) => {
                          const Icon = row.icon;
                          const value = fields[row.field] || "";
                          const invalid =
                            value && !isValidAdmissionField(row.field, value);
                          return (
                            <label
                              className={`admission-field row-${row.field}`}
                              key={row.field}
                            >
                              <span className="admission-field-icon">
                                <Icon size={17} />
                              </span>
                              <span className="admission-field-label">
                                {row.required && (
                                  <b className="admission-required">*</b>
                                )}
                                {t(fieldLabels[row.field])}
                              </span>
                              <span className="admission-field-control">
                                {row.select ? (
                                  <Select
                                    value={value || undefined}
                                    onChange={(next) =>
                                      updateField(row.field, next)
                                    }
                                    placeholder={t(
                                      "admissionDemo.relationshipPlaceholder",
                                    )}
                                    options={RELATIONSHIP_OPTIONS.map(
                                      (key) => ({
                                        value: t(`admissionDemo.${key}`),
                                        label: t(`admissionDemo.${key}`),
                                      }),
                                    )}
                                  />
                                ) : (
                                  <Input
                                    value={value}
                                    onChange={(event) =>
                                      updateField(row.field, event.target.value)
                                    }
                                    placeholder={t(
                                      `admissionDemo.placeholders.${row.field}`,
                                    )}
                                    status={invalid ? "error" : undefined}
                                  />
                                )}
                                {row.field === "contact_phone" &&
                                  value &&
                                  !invalid && (
                                    <CheckCircle2
                                      className="admission-field-ok"
                                      size={19}
                                    />
                                  )}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                      <aside className="admission-speech-suggestions">
                        <h3>{t("admissionDemo.detailsSuggestions")}</h3>
                        {[
                          "suggestionContactName",
                          "suggestionContactPhone",
                          "suggestionRelation",
                          "suggestionAddress",
                          "suggestionFullAddress",
                        ].map((key) => (
                          <button
                            type="button"
                            key={key}
                            disabled={pending}
                            onClick={() =>
                              void sendMessage(t(`admissionDemo.${key}`))
                            }
                          >
                            {t(`admissionDemo.${key}`)}
                          </button>
                        ))}
                      </aside>
                    </div>
                    {error && <Alert type="warning" showIcon message={error} />}
                    <div className="admission-details-bottom">
                      <small>
                        {missingField
                          ? questionFor(missingField, t)
                          : t("admissionDemo.detailsReady")}
                      </small>
                      <Button
                        type="primary"
                        onClick={confirmDetails}
                        disabled={pending}
                      >
                        {t("admissionDemo.confirmDetails")}
                      </Button>
                    </div>
                  </div>
                )}

                {stage === "fees" && (
                  <div className="admission-stage admission-fees-stage">
                    <div className="admission-stage-heading">
                      <span className="admission-stage-icon">4</span>
                      <div className="admission-stage-heading-copy">
                        <h2>{t("admissionDemo.feesTitle")}</h2>
                        <p>{t("admissionDemo.feesDescription")}</p>
                      </div>
                      <Button
                        className="admission-voice-guide"
                        icon={<Volume2 size={19} />}
                        onClick={() =>
                          speakAssistant(t("admissionDemo.feesVoiceGuide"))
                        }
                      >
                        {t("admissionDemo.voiceGuide")}
                      </Button>
                    </div>
                    <div className="admission-fee-tiles">
                      <div>
                        <span className="admission-fee-tile-icon">
                          <ShieldCheck size={24} />
                        </span>
                        <span className="admission-fee-tile-copy">
                          <small>{t("admissionDemo.insurance")}</small>
                          <strong>{t("admissionDemo.insuranceValue")}</strong>
                        </span>
                      </div>
                      <div>
                        <span className="admission-fee-tile-icon plain">
                          <CheckCircle2 size={24} />
                        </span>
                        <span className="admission-fee-tile-copy">
                          <small>{t("admissionDemo.insuranceStatus")}</small>
                          <strong className="success">
                            {t("admissionDemo.normalStatus")}
                          </strong>
                          <small>{t("admissionDemo.insuranceStatusSub")}</small>
                        </span>
                      </div>
                      <div>
                        <span className="admission-fee-tile-icon">
                          <BedDouble size={24} />
                        </span>
                        <span className="admission-fee-tile-copy">
                          <small>{t("admissionDemo.admissionType")}</small>
                          <strong>
                            {t("admissionDemo.admissionTypeValue")}
                          </strong>
                        </span>
                      </div>
                      <div>
                        <span className="admission-fee-tile-icon">
                          <CircleHelp size={24} />
                        </span>
                        <span className="admission-fee-tile-copy">
                          <small>{t("admissionDemo.estimatedDeposit")}</small>
                          <strong className="deposit">
                            {t("admissionDemo.depositValue")}
                          </strong>
                          <small>{t("admissionDemo.depositHint")}</small>
                        </span>
                      </div>
                    </div>
                    <div className="admission-fees-lower">
                      <div className="admission-check-summary">
                        <h3>{t("admissionDemo.completeChecks")}</h3>
                        {[
                          ["insuranceChecked", "insuranceCheckedSub"],
                          ["feeChecked", "feeCheckedSub"],
                          ["depositShown", "depositShownSub"],
                        ].map(([key, sub]) => (
                          <p key={key}>
                            <CheckCircle2 size={20} />
                            <span>
                              <strong>{t(`admissionDemo.${key}`)}</strong>
                              <small>{t(`admissionDemo.${sub}`)}</small>
                            </span>
                          </p>
                        ))}
                      </div>
                      <div className="admission-fee-warning">
                        <strong>{t("admissionDemo.feeWarnTitle")}</strong>
                        <ul>
                          {["one", "two", "three", "four"].map((key) => (
                            <li key={key}>
                              {t(`admissionDemo.feeWarn.${key}`)}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                    <div className="admission-fee-consents">
                      <Checkbox
                        checked={insuranceAcknowledged}
                        onChange={(event) =>
                          setInsuranceAcknowledged(event.target.checked)
                        }
                      >
                        <strong>
                          {t("admissionDemo.insuranceAcknowledgment")}
                        </strong>
                        <small>
                          {t("admissionDemo.insuranceAcknowledgmentHint")}
                        </small>
                      </Checkbox>
                      <Checkbox
                        checked={feesAcknowledged}
                        onChange={(event) =>
                          setFeesAcknowledged(event.target.checked)
                        }
                      >
                        <strong>{t("admissionDemo.feesAcknowledgment")}</strong>
                        <small>
                          {t("admissionDemo.feesAcknowledgmentHint")}
                        </small>
                      </Checkbox>
                    </div>
                    {error && <Alert type="warning" showIcon message={error} />}
                    <div className="admission-fees-submit">
                      <Button
                        type="primary"
                        disabled={!insuranceAcknowledged || !feesAcknowledged}
                        loading={submitting}
                        onClick={() => void submit()}
                      >
                        {submitting
                          ? t("admissionDemo.submitting")
                          : t("admissionDemo.submit")}
                      </Button>
                    </div>
                  </div>
                )}

                {stage === "submitted" && (
                  <div className="admission-stage admission-success">
                    <div className="admission-success-heading">
                      <div className="admission-success-icon">
                        <Check size={38} strokeWidth={3} />
                      </div>
                      <div>
                        <h2>{t("admissionDemo.successTitle")}</h2>
                        <p>{t("admissionDemo.successSubtitle")}</p>
                      </div>
                      <Button
                        className="admission-voice-guide"
                        icon={<Volume2 size={19} />}
                        onClick={() =>
                          speakAssistant(
                            `${t("admissionDemo.heroSuccessGreeting")} ${t(
                              "admissionDemo.heroSuccessMessage",
                            )}`,
                          )
                        }
                      >
                        {t("admissionDemo.voiceBroadcast")}
                      </Button>
                    </div>
                    <div className="admission-receipt-layout">
                      <div className="admission-receipt-data">
                        {[
                          ["receiptNumber", receipt],
                          ["receiptNameLabel", APPLICATION.patient],
                          ["departmentLabel", APPLICATION.department],
                          [
                            "receiptWardBed",
                            `${APPLICATION.ward} ${APPLICATION.bed}`,
                          ],
                          ["receiptTime", handledAt],
                          [
                            "receiptInsurance",
                            t("admissionDemo.insuranceValue"),
                          ],
                        ].map(([label, value]) => (
                          <div key={label}>
                            <span>{t(`admissionDemo.${label}`)}</span>
                            <strong>{value}</strong>
                          </div>
                        ))}
                      </div>
                      <div className="admission-receipt-slip">
                        <span className="admission-receipt-slip-head">
                          <i>+</i>
                          <span>
                            <strong>{t("admissionDemo.kioskHospital")}</strong>
                            <b>{t("admissionDemo.receiptSlipTitle")}</b>
                          </span>
                        </span>
                        <div className="admission-receipt-slip-rows">
                          <div>
                            <span>{t("admissionDemo.receiptNumber")}</span>
                            <b>{APPLICATION.applicationId}</b>
                          </div>
                          <div>
                            <span>{t("admissionDemo.receiptNameLabel")}</span>
                            <b>{APPLICATION.patient}</b>
                          </div>
                          <div>
                            <span>{t("admissionDemo.departmentLabel")}</span>
                            <b>{APPLICATION.department}</b>
                          </div>
                          <div>
                            <span>{t("admissionDemo.receiptWardBed")}</span>
                            <b>
                              {APPLICATION.ward} {APPLICATION.bed}
                            </b>
                          </div>
                          <div>
                            <span>{t("admissionDemo.receiptTime")}</span>
                            <b>{handledAt}</b>
                          </div>
                          <div>
                            <span>{t("admissionDemo.receiptInsurance")}</span>
                            <b>{t("admissionDemo.insuranceValue")}</b>
                          </div>
                        </div>
                        <span
                          className="admission-barcode"
                          aria-hidden="true"
                        />
                        <code>{APPLICATION.applicationId}</code>
                        <small>{t("admissionDemo.receiptKeep")}</small>
                      </div>
                    </div>
                    <div className="admission-success-actions">
                      {[
                        {
                          label: "printReceipt",
                          hint: "printReceiptSub",
                          icon: Printer,
                          primary: true,
                          run: () =>
                            setSupportNotice(t("admissionDemo.printDemoHint")),
                        },
                        {
                          label: "findWard",
                          hint: "findWardSub",
                          icon: MapPin,
                          primary: false,
                          run: () =>
                            setSupportNotice(t("admissionDemo.wardDemoHint")),
                        },
                        {
                          label: "sendWechat",
                          hint: "sendWechatSub",
                          icon: MessageCircle,
                          primary: false,
                          green: true,
                          run: () =>
                            setSupportNotice(t("admissionDemo.wechatDemoHint")),
                        },
                        {
                          label: "sendSms",
                          hint: "sendSmsSub",
                          icon: MessageSquareText,
                          primary: false,
                          run: () =>
                            setSupportNotice(t("admissionDemo.smsDemoHint")),
                        },
                      ].map((action) => {
                        const Icon = action.icon;
                        return (
                          <Button
                            key={action.label}
                            type={action.primary ? "primary" : "default"}
                            className={
                              action.green
                                ? "admission-action-wechat"
                                : undefined
                            }
                            onClick={action.run}
                          >
                            <Icon size={20} />
                            <span className="admission-btn-copy">
                              <strong>
                                {t(`admissionDemo.${action.label}`)}
                              </strong>
                              <small>{t(`admissionDemo.${action.hint}`)}</small>
                            </span>
                          </Button>
                        );
                      })}
                    </div>
                    {supportNotice && (
                      <p className="admission-success-notice" role="status">
                        {supportNotice}
                      </p>
                    )}
                    <Button className="admission-restart" onClick={restart}>
                      {t("admissionDemo.restart")}
                    </Button>
                  </div>
                )}
              </section>
            </section>

            <aside className="admission-side-panel">
              <div className="admission-side-card admission-side-qr">
                <h2>
                  <span className="admission-side-number">1</span>
                  {t(
                    stage === "submitted"
                      ? "admissionDemo.resultSyncedTitle"
                      : "admissionDemo.qrFollowTitle",
                  )}
                </h2>
                <div className="admission-qr-content">
                  <div className="admission-qr" aria-hidden="true">
                    <img src="/admission-demo/demo-qr.svg" alt="" />
                    <span />
                  </div>
                  <ul>
                    {(stage === "submitted"
                      ? [
                          "syncedSlip",
                          "syncedSent",
                          "syncedWard",
                          "syncedGuide",
                        ]
                      : [
                          "progressNotice",
                          "admissionReminder",
                          "feeChange",
                          "serviceGuide",
                        ]
                    ).map((key) => (
                      <li key={key}>
                        <CheckCircle2 size={17} />
                        {t(`admissionDemo.${key}`)}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="admission-qr-footer">
                  <small>{t("admissionDemo.qrFollowHint")}</small>
                  <button
                    type="button"
                    disabled={stage !== "identity"}
                    onClick={() => setSmsFallback(true)}
                  >
                    {t("admissionDemo.smsFallback")}
                    <ArrowRight size={14} />
                  </button>
                </div>
              </div>
              <div className="admission-side-card admission-side-patient">
                {stage === "submitted" ? (
                  <>
                    <h2>{t("admissionDemo.followUpTitle")}</h2>
                    <p className="admission-follow-up-intro">
                      {t("admissionDemo.followUpIntro")}
                    </p>
                    <div className="admission-follow-up">
                      {[
                        ["followUpOne", "followUpOneHint"],
                        ["followUpTwo", "followUpTwoHint"],
                        ["followUpThree", "followUpThreeHint"],
                      ].map(([title, hint], index) => (
                        <div className="admission-follow-up-item" key={title}>
                          <span>{index + 1}</span>
                          <div>
                            <strong>{t(`admissionDemo.${title}`)}</strong>
                            <small>{t(`admissionDemo.${hint}`)}</small>
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="admission-follow-up-help">
                      {t("admissionDemo.followUpHelp")}
                    </p>
                  </>
                ) : (
                  <>
                    <h2>
                      {t("admissionDemo.patientInfoTitle")}
                      <span>
                        {stage === "identity"
                          ? t("admissionDemo.patientAfterVerify")
                          : undefined}
                      </span>
                      {stage !== "identity" && (
                        <button
                          type="button"
                          className="admission-patient-refresh"
                          onClick={() =>
                            speakAssistant(
                              t(`admissionDemo.hero${heroKey}Message`),
                            )
                          }
                        >
                          <RefreshCw size={14} />
                          {t("admissionDemo.refresh")}
                        </button>
                      )}
                    </h2>
                    {stage === "identity" ? (
                      <>
                        <div
                          className="admission-patient-placeholder"
                          aria-hidden="true"
                        >
                          <span />
                          <i />
                        </div>
                        <p className="admission-patient-placeholder-copy">
                          {t("admissionDemo.patientPlaceholder")}
                        </p>
                        <div className="admission-patient-tip">
                          <span>i</span>
                          {t("admissionDemo.patientPrivacyHint")}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="admission-patient-head">
                          <div className="admission-patient-photo">
                            <img
                              src="/admission-demo/patient-portrait.webp"
                              alt={t("admissionDemo.patientPhotoAlt")}
                            />
                          </div>
                          <div className="admission-patient-id">
                            <p>
                              <strong>{APPLICATION.patient}</strong>
                              <em>{t("admissionDemo.patientSelf")}</em>
                            </p>
                            <small>
                              {t("admissionDemo.genderValue")}{" "}
                              {t("admissionDemo.ageValue")} ·{" "}
                              {APPLICATION.maskedPhone}
                            </small>
                            <small>
                              {t("admissionDemo.idNumberLabel")}{" "}
                              {APPLICATION.maskedId}
                            </small>
                          </div>
                        </div>
                        {stage === "application" && (
                          <p className="admission-patient-note">
                            {t("admissionDemo.patientInfoNote")}
                            <small>{t("admissionDemo.patientPhotoNote")}</small>
                          </p>
                        )}
                        <div className="admission-patient-rows">
                          {patientRows()}
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            </aside>
          </main>
          <footer className="admission-kiosk-footer">
            <button
              type="button"
              className="admission-return"
              onClick={restart}
            >
              <House size={26} />
              <span className="admission-btn-copy">
                <strong>{t("admissionDemo.backHome")}</strong>
                <small>{t("admissionDemo.backHomeSub")}</small>
              </span>
            </button>
            <div className="admission-voice-block">
              <div
                className={`admission-voice-console${
                  voiceInput.recording ? " is-recording" : ""
                }`}
              >
                <Button
                  className="admission-mic-button"
                  shape="circle"
                  aria-label={
                    voiceInput.recording
                      ? t("voice.stopRecording")
                      : t("admissionDemo.voiceInput")
                  }
                  title={
                    voiceInput.recording
                      ? t("voice.stopRecording")
                      : t("admissionDemo.voiceInput")
                  }
                  disabled={pending || voiceInput.transcribing}
                  type={voiceInput.recording ? "primary" : "default"}
                  icon={<Mic size={32} />}
                  onClick={toggleVoiceEntry}
                />
                <div className="admission-voice-copy">
                  <strong>
                    {voiceInput.transcribing
                      ? t("voice.transcribing")
                      : voiceInput.recording
                      ? t("admissionDemo.voiceRecording")
                      : voiceCopy[stage].title}
                  </strong>
                  <span>
                    {voiceInput.recording
                      ? t(
                          voiceDetected
                            ? "admissionDemo.voiceRecordingDetected"
                            : "admissionDemo.voiceRecordingWaiting",
                        )
                      : voiceInput.transcribing
                      ? t("admissionDemo.voiceTranscribingHint")
                      : voiceCopy[stage].sub}
                  </span>
                </div>
                {voiceInput.recording && voiceLevelAvailable && (
                  <div
                    ref={voiceWaveLeftRef}
                    className="admission-waveform active"
                    aria-hidden="true"
                  >
                    {Array.from({ length: 32 }, (_, index) => (
                      <i
                        key={index}
                        style={{ height: `${8 + ((index * 7) % 20)}px` }}
                      />
                    ))}
                  </div>
                )}
                {voiceInput.recording && (
                  <>
                    <span className="admission-voice-duration" aria-live="off">
                      {formatRecordingTime(voiceElapsedSeconds)}
                    </span>
                    <Button
                      className="admission-stop-recording"
                      danger
                      icon={<Square size={14} fill="currentColor" />}
                      onClick={() => voiceInput.stop()}
                    >
                      {t("admissionDemo.endRecording")}
                    </Button>
                  </>
                )}
              </div>
              {(voiceTranscript || (voiceInput.recording && draft.trim())) && (
                <div className="admission-voice-transcript" role="status">
                  <MessageSquareText size={15} aria-hidden="true" />
                  <span title={voiceTranscript || draft}>
                    {voiceTranscript || draft.trim()}
                  </span>
                </div>
              )}
              <div className="admission-quick-chips">
                {quickChips[stage].map((chip) => (
                  <button
                    type="button"
                    key={chip.label}
                    onClick={chip.run}
                    disabled={pending}
                  >
                    “{chip.label}”
                  </button>
                ))}
              </div>
              <p className="admission-footer-note" role="status">
                {supportNotice ||
                  (voiceTranscript &&
                  voiceStartStageRef.current !== "details" &&
                  stage !== "details"
                    ? t("admissionDemo.voiceTranscriptRequiresDetails")
                    : t("admissionDemo.footer"))}
              </p>
            </div>
            <div className="admission-footer-help">
              <Button
                className="admission-help-button"
                icon={<UserRound size={24} />}
                onClick={() =>
                  setSupportNotice(t("admissionDemo.helpUnavailable"))
                }
              >
                <span className="admission-btn-copy">
                  <strong>{t("admissionDemo.humanHelp")}</strong>
                  <small>{t("admissionDemo.humanHelpSub")}</small>
                </span>
              </Button>
              {stage === "details" && (
                <Button
                  className="admission-manual-input"
                  icon={<FileText size={19} />}
                  onClick={() => setManualInputOpen(true)}
                >
                  <span className="admission-btn-copy">
                    <strong>{t("admissionDemo.manualInput")}</strong>
                    <small>{t("admissionDemo.manualInputSub")}</small>
                  </span>
                </Button>
              )}
            </div>
          </footer>
          <Modal
            title={t("admissionDemo.manualEntry")}
            open={manualInputOpen}
            onCancel={() => setManualInputOpen(false)}
            onOk={() => {
              if (stage !== "details") return;
              setManualInputOpen(false);
              void sendMessage();
            }}
            okText={t("admissionDemo.send")}
            confirmLoading={pending}
            okButtonProps={{
              disabled: !draft.trim() || pending || stage !== "details",
            }}
          >
            <Input.TextArea
              autoFocus
              rows={4}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={t("admissionDemo.inputPlaceholder")}
              maxLength={2000}
              onPressEnter={(event) => {
                if (!event.shiftKey) {
                  event.preventDefault();
                  setManualInputOpen(false);
                  void sendMessage();
                }
              }}
            />
          </Modal>
        </div>
      </div>
    </div>
  );
}
