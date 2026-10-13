import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface PrivacyDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

/*
 * Datenschutzerklärung. Platzhalter in eckigen Klammern vor der Veröffentlichung ausfüllen
 * und die Angaben rechtlich prüfen lassen.
 */
const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="space-y-1.5">
    <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">{title}</h3>
    <div className="text-xs text-stone-600 dark:text-stone-400 leading-relaxed space-y-2">{children}</div>
  </section>
);

export const PrivacyDialog: React.FC<PrivacyDialogProps> = ({ isOpen, onClose }) => {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="privacy-title"
        className="w-full max-w-lg bg-[#FAF8F5] dark:bg-[#1A1816] rounded-t-3xl sm:rounded-2xl shadow-2xl border border-stone-200 dark:border-stone-800 max-h-[90dvh] flex flex-col font-mela-sans"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-200 dark:border-stone-800">
          <h2 id="privacy-title" className="font-mela-serif text-lg font-bold text-stone-900 dark:text-stone-100">
            Datenschutz
          </h2>
          <button
            onClick={onClose}
            aria-label="Schließen"
            className="w-8 h-8 flex items-center justify-center rounded-full bg-stone-200/70 dark:bg-stone-800 text-stone-600 dark:text-stone-300"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5 overflow-y-auto">
          <Section title="Verantwortlicher">
            <p>
              Korbinian Eller, Hemauerstraße 19 B, Regensburg
              <br />
              E-Mail: webmaster@kyrbii.de
            </p>
          </Section>

          <Section title="Welche Daten verarbeitet werden">
            <p>
              <span className="font-semibold">Konto:</span> Benutzername und ein Passwort-Hash. Das Passwort selbst wird nicht
              gespeichert. Der Hash ist mit scrypt gebildet.
            </p>
            <p>
              <span className="font-semibold">Anmeldung:</span> Der Server speichert einen Hash deines Anmeldetokens und das Ablaufdatum
              (30 Tage nach der Anmeldung). Fehlgeschlagene Anmeldungen zählt der Server 15 Minuten lang im Arbeitsspeicher, zusammen
              mit der IP-Adresse. Danach werden sie verworfen.
            </p>
            <p>
              <span className="font-semibold">Rezepte:</span> Die Rezepte liegen als Textdateien auf dem Server. Sie gehören keinem Konto.
              Bitte trage keine personenbezogenen Angaben über andere Menschen ein.
            </p>
            <p>
              <span className="font-semibold">Zugriffsprotokoll:</span> Der Webserver protokolliert Zeitpunkt, IP-Adresse und aufgerufenen
              Pfad jeder Anfrage. Aufbewahrung: 7 Tage.
            </p>
            <p>
              <span className="font-semibold">Im Browser:</span> Die App speichert auf deinem Gerät Anmeldetoken und Benutzername, einen
              Rezept-Zwischenspeicher, nicht gesendete Entwürfe sowie Einstellungen (Design, Favoriten, abgehakte Zutaten). Die App
              setzt keine Cookies und kein Tracking.
            </p>
          </Section>

          <Section title="KI-Import">
            <p>
              Beim Import aus einer Webseite, aus Text oder aus einem Foto wird der Inhalt an Google (Gemini API) gesendet, damit er in
              Cooklang umgewandelt wird. Bei einer Webseite ruft der Server die Seite selbst ab. Google verarbeitet die Daten nach den
              Bedingungen der Gemini API, die auch in Drittländern, etwa den USA, stattfinden kann. Hinweis: Weitere Nutzungsbedinungen
              können auf der Webstie von Google als auch Google Gemini nachgelesen werden. Die angegebenen Daten werden zu Trainingszwecken
              benutzt.
            </p>
            <p>Verzichte auf den Import, wenn der Inhalt Angaben über andere Personen enthält, die du nicht weitergeben möchtest.</p>
          </Section>

          <Section title="Empfänger">
            <p>
              Hosting: Strato AG in Berlin. Der Serverbetreiber kann auf Konto- und Rezeptdaten zugreifen. KI-Import: Google
              (siehe oben).
            </p>
          </Section>

          <Section title="Rechtsgrundlagen">
            <p>
              Konto, Anmeldung und Bereitstellung der Rezepte: Art. 6 Abs. 1 lit. b DSGVO. Schutz des Servers, Zugriffsprotokoll:
              Art. 6 Abs. 1 lit. f DSGVO. KI-Import: Art. 6 Abs. 1 lit. b DSGVO, weil du die Umwandlung ausdrücklich anstößt.
            </p>
          </Section>

          <Section title="Speicherdauer">
            <p>
              Konto und Anmeldetoken bleiben bis zur Löschung des Kontos bzw. bis zum Ablauf des Tokens. Rezepte bleiben, bis sie
              gelöscht werden.
            </p>
          </Section>

          <Section title="Konto löschen">
            <p>
              Unter Einstellungen → Konto → „Konto löschen“ entfernst du dein Konto und alle Anmeldungen. Rezepte bleiben erhalten, weil
              sie keinem Konto gehören.
            </p>
          </Section>

          <Section title="Deine Rechte">
            <p>
              Du hast das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit und
              Widerspruch. Wende dich dafür an den Verantwortlichen. Du kannst dich außerdem bei einer Datenschutz-Aufsichtsbehörde
              beschweren, zum Beispiel bei das Bayerische Landesamt für Datenschutzaufsicht, Promenade 18, 91522 Ansbach, www.lda.bayern.de.
            </p>
          </Section>

          <p className="text-[11px] text-stone-400 dark:text-stone-500">Stand: Oktober 2026</p>
        </div>
      </div>
    </div>
  );
};
