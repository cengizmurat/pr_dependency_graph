import { useState, useEffect } from "react";
import { Routes, Route } from "react-router-dom";
import { ConfigProvider, theme } from "antd";
import type { Locale } from "antd/es/locale";
import dayjs from "dayjs";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import LandingPage from "./components/LandingPage";
import GraphPage from "./components/GraphPage";

function useIsDarkMode() {
  const [dark, setDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return dark;
}

const ANTD_LOCALE_MAP: Record<string, () => Promise<{ default: Locale }>> = {
  en:    () => import("antd/locale/en_US"),
  "en-gb": () => import("antd/locale/en_GB"),
  fr:    () => import("antd/locale/fr_FR"),
  de:    () => import("antd/locale/de_DE"),
  es:    () => import("antd/locale/es_ES"),
  it:    () => import("antd/locale/it_IT"),
  pt:    () => import("antd/locale/pt_PT"),
  "pt-br": () => import("antd/locale/pt_BR"),
  nl:    () => import("antd/locale/nl_NL"),
  ja:    () => import("antd/locale/ja_JP"),
  ko:    () => import("antd/locale/ko_KR"),
  zh:    () => import("antd/locale/zh_CN"),
  "zh-tw": () => import("antd/locale/zh_TW"),
  ru:    () => import("antd/locale/ru_RU"),
  tr:    () => import("antd/locale/tr_TR"),
  pl:    () => import("antd/locale/pl_PL"),
  uk:    () => import("antd/locale/uk_UA"),
  ar:    () => import("antd/locale/ar_EG"),
  sv:    () => import("antd/locale/sv_SE"),
  da:    () => import("antd/locale/da_DK"),
  fi:    () => import("antd/locale/fi_FI"),
  nb:    () => import("antd/locale/nb_NO"),
  cs:    () => import("antd/locale/cs_CZ"),
  hu:    () => import("antd/locale/hu_HU"),
  ro:    () => import("antd/locale/ro_RO"),
  vi:    () => import("antd/locale/vi_VN"),
  th:    () => import("antd/locale/th_TH"),
  he:    () => import("antd/locale/he_IL"),
  hi:    () => import("antd/locale/hi_IN"),
};

function useAntdLocale() {
  const [locale, setLocale] = useState<Locale | undefined>(undefined);

  useEffect(() => {
    const lang = navigator.language.toLowerCase();
    const loader = ANTD_LOCALE_MAP[lang] ?? ANTD_LOCALE_MAP[lang.split("-")[0]];
    if (loader) {
      loader().then((mod) => setLocale(mod.default));
    }

    const dayjsLocale = lang.replace("_", "-");
    import(`dayjs/locale/${dayjsLocale}.js`)
      .catch(() => import(`dayjs/locale/${lang.split("-")[0]}.js`))
      .then(() => dayjs.locale(dayjsLocale.split("-")[0]))
      .catch(() => {});
  }, []);

  return locale;
}

export default function App() {
  const isDark = useIsDarkMode();
  const antdLocale = useAntdLocale();

  return (
    <ConfigProvider
      locale={antdLocale}
      theme={{
        algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
      }}
    >
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/:owner/:repo" element={<GraphPage />} />
      </Routes>
      <Analytics />
      <SpeedInsights />
    </ConfigProvider>
  );
}
