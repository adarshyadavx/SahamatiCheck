import { Anek_Devanagari, Anek_Latin, IBM_Plex_Mono, Noto_Sans, Noto_Sans_Devanagari } from "next/font/google";

export const anekLatin = Anek_Latin({ subsets: ["latin"], variable: "--font-anek-latin", display: "swap" });
export const anekDevanagari = Anek_Devanagari({ subsets: ["devanagari"], variable: "--font-anek-deva", display: "swap" });
export const notoSans = Noto_Sans({ subsets: ["latin"], variable: "--font-noto", display: "swap" });
export const notoDevanagari = Noto_Sans_Devanagari({ subsets: ["devanagari"], variable: "--font-noto-deva", display: "swap" });
export const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const fontVariables = [anekLatin, anekDevanagari, notoSans, notoDevanagari, plexMono].map((f) => f.variable).join(" ");
