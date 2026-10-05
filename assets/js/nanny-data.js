/* ==========================================================================
   Nanny map data: the pins on the Europe map and the nannies shown in each.

   HOW TO EDIT
   - Locations: each pin needs an id, name, country, lat/lon (from Google Maps:
     right-click a place and copy the two numbers) and a "destination" that
     matches an option in the Find Childcare form (book.html).
   - Nannies: add one entry per verified nanny, with "location" set to the id of
     their pin. Real nannies get a "Request [name]" button.
   - Every nanny marked  example: true  is a PLACEHOLDER that shows families how a
     profile will look. Delete them all and add real, verified nannies before
     launch. Only publish a nanny's details with their written consent.
   ========================================================================== */

window.PTN_LOCATIONS = [
  // Spain: mainland
  { id: 'costa-del-sol', name: 'Marbella & Costa del Sol', country: 'Spain', lat: 36.55, lon: -4.75, destination: 'Marbella',
    blurb: 'Our home base. Villas, beach clubs and family resorts from Málaga to Sotogrande.' },
  { id: 'madrid', name: 'Madrid', country: 'Spain', lat: 40.42, lon: -3.70, destination: 'Madrid',
    blurb: 'City hotels, apartments, conferences and family events in the capital.' },
  { id: 'barcelona', name: 'Barcelona', country: 'Spain', lat: 41.39, lon: 2.17, destination: 'Barcelona',
    blurb: 'Beach, culture and city breaks, with childcare at your hotel or apartment.' },
  // Spain: Balearic Islands
  { id: 'mallorca', name: 'Mallorca', country: 'Spain', lat: 39.62, lon: 2.95, destination: 'Mallorca',
    blurb: 'Island villas, resorts and yacht days around Palma and beyond.' },
  { id: 'ibiza', name: 'Ibiza', country: 'Spain', lat: 38.95, lon: 1.40, destination: 'Ibiza',
    blurb: 'Family villas and celebrations on the White Isle.' },
  // Portugal
  { id: 'lisbon', name: 'Lisbon', country: 'Portugal', lat: 38.72, lon: -9.14, destination: 'Lisbon',
    blurb: 'Hotels, apartments and day trips to Sintra and Cascais.' },
  { id: 'porto', name: 'Porto', country: 'Portugal', lat: 41.15, lon: -8.61, destination: 'Porto',
    blurb: 'City stays and wine-country weekends in the north.' },
  { id: 'algarve', name: 'Algarve', country: 'Portugal', lat: 37.10, lon: -8.25, destination: 'Algarve',
    blurb: 'Family resorts, golf and long beach days on the south coast.' },
  // France
  { id: 'paris', name: 'Paris', country: 'France', lat: 48.86, lon: 2.35, destination: 'Paris',
    blurb: 'City hotels and apartments, so parents can enjoy an evening out.' },
  { id: 'cote-d-azur', name: "Nice & Côte d'Azur", country: 'France', lat: 43.70, lon: 7.27, destination: "Nice & Côte d'Azur",
    blurb: 'Riviera villas, hotels, yachts and summer celebrations.' },
  // Germany
  { id: 'berlin', name: 'Berlin', country: 'Germany', lat: 52.52, lon: 13.40, destination: 'Berlin',
    blurb: 'City breaks, business trips and family visits.' },
  { id: 'munich', name: 'Munich', country: 'Germany', lat: 48.14, lon: 11.58, destination: 'Munich',
    blurb: 'Hotels, events and gateways to the Alps.' }
];

// Placeholder profiles (example: true). Replace with real, verified nannies.
window.PTN_NANNIES = [
  { location: 'costa-del-sol', example: true, name: 'Sofia', languages: ['English', 'Spanish'], years: 8, ages: 'Babies to 10 years',
    checks: ['Identity verified', 'References checked', 'First aid verified'], intro: 'Calm, playful and brilliant with little ones who are new to a holiday routine.' },
  { location: 'costa-del-sol', example: true, name: 'Emma', languages: ['English', 'French'], years: 5, ages: '2 to 12 years',
    checks: ['Identity verified', 'Video interview completed'], intro: 'Loves beach days, crafts and keeping older children busy and happy.' },
  { location: 'madrid', example: true, name: 'Lucía', languages: ['Spanish', 'English'], years: 6, ages: '1 to 8 years',
    checks: ['Identity verified', 'References checked'], intro: 'A former nursery assistant who makes city hotels feel like home.' },
  { location: 'barcelona', example: true, name: 'Clara', languages: ['English', 'Catalan', 'Spanish'], years: 7, ages: 'Babies to 6 years',
    checks: ['Identity verified', 'First aid verified'], intro: 'Gentle and organised, with lots of experience settling babies to sleep.' },
  { location: 'mallorca', example: true, name: 'Hannah', languages: ['English', 'German'], years: 9, ages: '3 to 12 years',
    checks: ['Identity verified', 'References checked', 'Video interview completed'], intro: 'Confident swimmer who loves pool games and island adventures.' },
  { location: 'ibiza', example: true, name: 'Mia', languages: ['English', 'Spanish'], years: 4, ages: '2 to 10 years',
    checks: ['Identity verified', 'References checked'], intro: 'Energetic and creative, perfect for villa holidays and celebrations.' },
  { location: 'lisbon', example: true, name: 'Inês', languages: ['Portuguese', 'English'], years: 6, ages: 'Babies to 8 years',
    checks: ['Identity verified', 'First aid verified'], intro: 'Warm and patient, and knows every family-friendly corner of Lisbon.' },
  { location: 'porto', example: true, name: 'Beatriz', languages: ['Portuguese', 'English', 'Spanish'], years: 5, ages: '1 to 10 years',
    checks: ['Identity verified', 'References checked'], intro: 'Calm and reliable, with a talent for bedtime routines.' },
  { location: 'algarve', example: true, name: 'Chloe', languages: ['English', 'Portuguese'], years: 7, ages: '2 to 12 years',
    checks: ['Identity verified', 'Video interview completed'], intro: 'Sporty, sunny and great with siblings of different ages.' },
  { location: 'paris', example: true, name: 'Camille', languages: ['French', 'English'], years: 8, ages: 'Babies to 10 years',
    checks: ['Identity verified', 'References checked', 'First aid verified'], intro: 'Creative and caring, with museum-friendly activities for curious kids.' },
  { location: 'cote-d-azur', example: true, name: 'Léa', languages: ['French', 'English', 'Italian'], years: 6, ages: '2 to 10 years',
    checks: ['Identity verified', 'References checked'], intro: 'Experienced with villa and yacht holidays along the Riviera.' },
  { location: 'berlin', example: true, name: 'Lena', languages: ['German', 'English'], years: 5, ages: '1 to 8 years',
    checks: ['Identity verified', 'Video interview completed'], intro: 'Organised, kind and full of ideas for rainy-day fun.' },
  { location: 'munich', example: true, name: 'Anna', languages: ['German', 'English'], years: 9, ages: 'Babies to 12 years',
    checks: ['Identity verified', 'References checked', 'First aid verified'], intro: 'Outdoorsy and calm, and loves taking families to the lakes and parks.' }
];
