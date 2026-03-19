# Enrichir les donnees Contentsquare - Tracking personnalise

Guide pour envoyer des donnees custom depuis le site Bouygues Telecom vers Contentsquare via le tag JS.

## 1. Dynamic Variables (Custom Variables)

Jusqu'a 40 slots disponibles. Cree des segments automatiques dans CS pour filtrer toutes les analyses.

```js
window._uxa = window._uxa || [];

// Slot 1 : Type de parcours
window._uxa.push(['setCustomVariable', 1, 'plan_type', 'Sensation 100Go']);

// Slot 2 : Type d'utilisateur
window._uxa.push(['setCustomVariable', 2, 'user_type', 'prospect']); // prospect | client | pro

// Slot 3 : Eligibilite fibre
window._uxa.push(['setCustomVariable', 3, 'eligibilite_fibre', 'oui']); // oui | non | inconnue

// Slot 4 : Type de parcours
window._uxa.push(['setCustomVariable', 4, 'type_parcours', 'renouvellement']); // renouvellement | souscription | fai

// Slot 5 : Montant panier
window._uxa.push(['setCustomVariable', 5, 'panier_montant', '29.99']);
```

## 2. Tracking e-commerce / transactions

Debloque les metriques **revenue**, **panier moyen**, **taux de transaction** dans CS.

```js
// Quand la commande est confirmee
window._uxa.push(['ec:transaction', {
  id: 'CMD-123456',
  revenue: 29.99,       // montant TTC
  tax: 5.00,
  shipping: 0,
  currency: 'EUR'
}]);

// Detail de la commande
window._uxa.push(['ec:addItem', {
  id: 'CMD-123456',
  name: 'Sensation 100Go',
  price: 29.99,
  quantity: 1,
  category: 'Forfait Mobile'   // Forfait Mobile | Internet Fixe | Accessoire
}]);
```

## 3. Dynamic Variables de page

Tagguer chaque page avec des infos contextuelles. Granularite plus fine que les custom variables.

```js
// Etape du panier
window._uxa.push(['trackDynamicVariable', { key: 'etape_panier', value: 'recapitulatif' }]);

// Nombre d'articles dans le panier
window._uxa.push(['trackDynamicVariable', { key: 'nb_articles', value: '3' }]);

// Erreur API rencontree
window._uxa.push(['trackDynamicVariable', { key: 'erreur_api', value: '404_verifications_bancaires' }]);

// Performance ressentie
window._uxa.push(['trackDynamicVariable', { key: 'temps_chargement_api', value: 'slow' }]); // fast | normal | slow

// Offre consultee
window._uxa.push(['trackDynamicVariable', { key: 'offre_consultee', value: 'bbox_fibre' }]);
```

## 4. Events personnalises

Tracker des actions specifiques qui ne sont pas des pageviews.

```js
window._uxa.push(['trackEvent', 'clic_bouton_commander']);
window._uxa.push(['trackEvent', 'erreur_formulaire_iban']);
window._uxa.push(['trackEvent', 'popup_promo_affichee']);
window._uxa.push(['trackEvent', 'chat_ouvert']);
window._uxa.push(['trackEvent', 'comparateur_utilise']);
```

## 5. Identification utilisateur

Pour le suivi cross-session et la reconciliation des parcours.

```js
window._uxa.push(['setUserId', 'USR-789012']);
```

## Priorites d'implementation

| Priorite | Donnee a envoyer | Effet dans CS | Impact dashboard |
|----------|-------------------|---------------|------------------|
| **1** | `ec:transaction` avec revenue | Debloque CA, panier moyen, revenue/session | Chiffre les conversions perdues en euros |
| **2** | Custom var `type_parcours` | Segmente les funnels automatiquement | Funnels filtres par parcours |
| **3** | Custom var `eligibilite` | Comprend les drop-offs FAI | Explique le 0.44% conversion FAI |
| **4** | `trackDynamicVariable` erreurs API | Correle erreurs specifiques <-> pages | Lie erreurs au contexte page |
| **5** | Custom var `panier_montant` | Chiffre les conversions perdues en EUR | 29,419 conversions perdues x panier moyen = impact EUR |
| **6** | `setUserId` | Parcours cross-session | Comprend les retours utilisateurs |

## Exemple d'implementation complete (page panier)

```js
window._uxa = window._uxa || [];

// Variables de session
window._uxa.push(['setCustomVariable', 1, 'type_parcours', 'renouvellement']);
window._uxa.push(['setCustomVariable', 2, 'user_type', 'client']);
window._uxa.push(['setUserId', userId]);

// Variables de page
window._uxa.push(['trackDynamicVariable', { key: 'etape_panier', value: 'recapitulatif' }]);
window._uxa.push(['trackDynamicVariable', { key: 'nb_articles', value: String(cart.items.length) }]);
window._uxa.push(['trackDynamicVariable', { key: 'montant_panier', value: String(cart.total) }]);

// Tracking erreurs API
try {
  const response = await fetch('/api/verifications-bancaires');
  if (!response.ok) {
    window._uxa.push(['trackDynamicVariable', {
      key: 'erreur_api',
      value: `${response.status}_verifications_bancaires`
    }]);
    window._uxa.push(['trackEvent', 'erreur_api_bancaire']);
  }
} catch (err) {
  window._uxa.push(['trackEvent', 'erreur_reseau']);
}

// Tracking transaction a la confirmation
window._uxa.push(['ec:transaction', {
  id: order.id,
  revenue: order.total,
  currency: 'EUR'
}]);
```

## Notes

- Les custom variables sont envoyees une fois par session (persistantes)
- Les dynamic variables sont envoyees par pageview (contextuelles)
- Les events sont ponctuels (un clic, une erreur)
- Le tracking e-commerce necessite d'etre active cote Contentsquare (contacter le CSM)
- Toutes les valeurs doivent etre des **strings** (pas de nombres directement)
