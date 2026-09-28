# Domande aperte

- Quando gli orari giornalieri 2026/2027 saranno pubblicati, rieseguire
  `barb:sync:schedule`, verificare le lezioni e applicare l'overlay.
- Per dichiarare la sync cloud pronta su più dispositivi, serve una prova
  end-to-end con backend Supabase di test, schema SQL aggiornato, due sessioni,
  offline e cambio account. Le credenziali di test non sono nel repository.
- Verificare nella Dashboard Supabase che Site URL e Redirect URLs consentano
  `https://massimilianociconte.github.io/StudyOS/` per la conferma email.
- La cifratura end-to-end del cloud non è implementata: richiede un formato
  condiviso e una strategia di migrazione dei payload esistenti.
