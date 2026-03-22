import { Cormorant_Garamond, DM_Mono, Instrument_Sans } from "next/font/google";

export const landingDisplayFont = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  style: ["normal", "italic"],
  display: "swap"
});

export const landingBodyFont = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap"
});

export const landingMonoFont = DM_Mono({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  display: "swap"
});
