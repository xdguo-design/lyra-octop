import { useEffect, useState } from "react";
import { ArrowLeft, Mic } from "lucide-react";
import { Button, Card, Tag, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { voiceApi, type ActiveVoice } from "../../api/modules/voice";
import "./index.css";

export default function SpeechRecognitionPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [activeVoice, setActiveVoice] = useState<ActiveVoice | null>(null);
  const [configFailed, setConfigFailed] = useState(false);

  useEffect(() => {
    let mounted = true;
    void voiceApi
      .getActive()
      .then((result) => {
        if (mounted) setActiveVoice(result);
      })
      .catch(() => {
        if (mounted) setConfigFailed(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <main className="speech-page">
      <header className="speech-header">
        <Button
          type="text"
          icon={<ArrowLeft size={18} />}
          onClick={() => navigate("/creations")}
        >
          {t("speechRecognition.back")}
        </Button>
        <span>LYRA</span>
      </header>
      <section className="speech-content">
        <div className="speech-heading">
          <Typography.Text className="speech-eyebrow">
            {t("speechRecognition.eyebrow")}
          </Typography.Text>
          <Typography.Title level={1}>
            {t("speechRecognition.title")}
          </Typography.Title>
          <Typography.Paragraph>
            {t("speechRecognition.description")}
          </Typography.Paragraph>
        </div>

        <Card className="speech-recorder-card">
          <div className="speech-provider-row">
            <Tag color={configFailed ? "red" : "blue"}>
              {configFailed
                ? t("speechRecognition.providerUnavailable")
                : activeVoice?.stt
                ? t("speechRecognition.provider", {
                    provider: activeVoice.stt,
                  })
                : t("speechRecognition.loadingProvider")}
            </Tag>
            {activeVoice?.stt_realtime && (
              <Tag color="green">{t("speechRecognition.realtime")}</Tag>
            )}
          </div>
          <Button
            className="speech-mic-button"
            type="primary"
            shape="circle"
            size="large"
            aria-label={t("speechRecognition.start")}
            icon={<Mic size={28} />}
            onClick={() => navigate("/chat", { state: { autoVoice: true } })}
          />
          <span className="speech-action-label">
            {t("speechRecognition.start")}
          </span>
          <p className="speech-hint">{t("speechRecognition.readyHint")}</p>
        </Card>
      </section>
    </main>
  );
}
