import { request } from "../request";

export type AdmissionExtractionFields = Record<string, string>;

export const admissionDemoApi = {
  extract: (text: string) =>
    request<{ fields: AdmissionExtractionFields }>("/admission-demo/extract", {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
};
