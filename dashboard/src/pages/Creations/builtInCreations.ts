interface BuiltInCreationBase {
  id: string;
  category: "platform" | "service" | "applet";
  titleKey: string;
  descriptionKey: string;
  thumb?: string;
}

export type BuiltInAppCreation = BuiltInCreationBase & {
  type: "app";
  url: string;
  route?: string;
};
export type BuiltInExternalCreation = BuiltInCreationBase & {
  type: "external";
  url: string | null;
};
export type BuiltInCreation = BuiltInAppCreation | BuiltInExternalCreation;

export const PLANET_URL = "http://127.0.0.1:8130/";

export const BUILT_IN_CREATIONS: BuiltInCreation[] = [
  {
    id: "ppt-studio",
    type: "app",
    category: "platform",
    titleKey: "pptStudio.title",
    descriptionKey: "pptStudio.creationDescription",
    thumb: "/ppt-studio-cover.svg",
    url: "/ppt-studio",
    route: "/ppt-studio",
  },
  {
    id: "speech-recognition",
    type: "app",
    category: "applet",
    titleKey: "creationsPage.builtIn.speechRecognition",
    descriptionKey: "creationsPage.builtIn.speechRecognitionDescription",
    thumb: "/speech-recognition/home-cover.svg",
    url: "/speech-recognition",
    route: "/speech-recognition",
  },
  {
    id: "admission-demo",
    type: "app",
    category: "applet",
    titleKey: "creationsPage.builtIn.admissionDemo",
    descriptionKey: "creationsPage.builtIn.admissionDemoDescription",
    thumb: "/admission-demo/home-cover.jpg",
    url: "/admission-demo",
    route: "/admission-demo",
  },
  {
    id: "admission-registration",
    type: "app",
    category: "applet",
    titleKey: "creationsPage.builtIn.admissionRegistration",
    descriptionKey: "creationsPage.builtIn.admissionRegistrationDescription",
    thumb: "/admission-registration-home-cover.jpg",
    url: "/admission-registration/index.html",
  },
  {
    id: "planet",
    type: "app",
    category: "platform",
    titleKey: "creationsPage.builtIn.planet",
    descriptionKey: "creationsPage.builtIn.planetDescription",
    thumb: "/workbench/thumbs/planet.png",
    url: PLANET_URL,
  },
  {
    id: "ehr-knowledge-platform",
    type: "app",
    category: "platform",
    titleKey: "creationsPage.builtIn.ehrKnowledgePlatform",
    descriptionKey: "creationsPage.builtIn.ehrKnowledgePlatformDescription",
    thumb: "/ehr-knowledge-cover.svg",
    url: "/public/ehr",
    route: "/ehr",
  },
  {
    id: "lyra-print",
    type: "external",
    category: "service",
    titleKey: "creationsPage.builtIn.lyraPrint",
    descriptionKey: "creationsPage.builtIn.lyraPrintDescription",
    url: "https://119.3.216.103/",
  },
  {
    id: "lyra-agents",
    type: "external",
    category: "service",
    titleKey: "creationsPage.builtIn.lyraAgents",
    descriptionKey: "creationsPage.builtIn.lyraAgentsDescription",
    url: "https://119.3.216.103/agents/",
  },
  {
    id: "lyra-narrative",
    type: "external",
    category: "service",
    titleKey: "creationsPage.builtIn.lyraNarrative",
    descriptionKey: "creationsPage.builtIn.lyraNarrativeDescription",
    url: "http://119.3.216.103:9090/",
  },
  {
    id: "manus-clinicemr",
    type: "external",
    category: "service",
    titleKey: "creationsPage.builtIn.manus-clinicemr",
    descriptionKey: "creationsPage.builtIn.manus-clinicemrDescription",
    url: "https://clinicemr-7tb6c7b9.manus.space/",
  },
];
