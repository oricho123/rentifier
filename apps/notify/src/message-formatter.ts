import type { ListingRow } from '@rentifier/db';

export class MessageFormatter {
  format(listing: ListingRow): string {
    const parts: string[] = [];

    parts.push(`<b>${this.escapeHtml(listing.title)}</b>`);

    if (listing.price != null && listing.currency) {
      parts.push(`💰 ${this.formatPrice(listing.price, listing.currency, listing.price_period)}`);
    }

    if (listing.bedrooms != null) {
      const roomsText = listing.bedrooms === 0 ? 'Studio' : `${listing.bedrooms} rooms`;
      parts.push(`🏠 ${roomsText}`);
    }

    const address = this.formatAddress(listing);
    if (address) {
      parts.push(`📍 ${address}`);
    }

    parts.push(`\n<a href="${listing.url}">View Listing</a>`);

    return parts.join('\n');
  }

  private formatPrice(amount: number, currency: string, period: string | null): string {
    const symbol = currency === 'ILS' ? '₪' : currency === 'USD' ? '$' : '€';
    const formatted = amount.toLocaleString('en-US');
    const periodText = period ? `/${period}` : '';
    return `${symbol}${formatted}${periodText}`;
  }

  private formatAddress(listing: ListingRow): string | null {
    // If we have street, show: City - Neighborhood, [Street Number](link)
    // Otherwise fallback to: City - Neighborhood

    if (!listing.city) return null;

    const locationParts: string[] = [listing.city];
    if (listing.neighborhood) {
      locationParts.push(listing.neighborhood);
    }
    const location = locationParts.join(' - ');

    if (listing.street) {
      // Build clickable street address
      let streetText = listing.street;
      if (listing.house_number) {
        // Convert float to integer for cleaner display
        const houseNum = Math.floor(parseFloat(listing.house_number));
        streetText += ` ${houseNum}`;
      }

      const mapsUrl = this.buildMapsUrl(listing);
      return `${location}, <a href="${mapsUrl}">${this.escapeHtml(streetText)}</a>`;
    } else {
      // No street, just show location
      return location;
    }
  }

  private buildMapsUrl(listing: ListingRow): string {
    const parts: string[] = [];

    if (listing.street) parts.push(listing.street);
    if (listing.house_number) {
      // Convert float to integer string for cleaner maps search
      const houseNum = Math.floor(parseFloat(listing.house_number));
      parts.push(String(houseNum));
    }
    if (listing.city) {
      // Convert English city names to Hebrew for better maps results
      const hebrewCity = this.toHebrewCity(listing.city);
      parts.push(hebrewCity);
    }

    const query = parts.join(' ');
    const encoded = encodeURIComponent(query);

    // For Telegram HTML parsing, & in href must be escaped as &amp;
    return `https://www.google.com/maps/search/?api=1&amp;query=${encoded}`;
  }

  private toHebrewCity(cityEnglish: string): string {
    const cityMap: Record<string, string> = {
      'Tel Aviv': 'תל אביב',
      'Jerusalem': 'ירושלים',
      'Haifa': 'חיפה',
      'Rishon LeZion': 'ראשון לציון',
      'Petah Tikva': 'פתח תקווה',
      'Ashdod': 'אשדוד',
      'Netanya': 'נתניה',
      'Beersheba': 'באר שבע',
      'Holon': 'חולון',
      'Bnei Brak': 'בני ברק',
      'Ramat Gan': 'רמת גן',
      'Ashkelon': 'אשקלון',
      'Rehovot': 'רחובות',
      'Bat Yam': 'בת ים',
      'Herzliya': 'הרצליה',
      'Kfar Saba': 'כפר סבא',
      'Hadera': 'חדרה',
      'Modiin': 'מודיעין',
      'Nazareth': 'נצרת',
      'Lod': 'לוד',
      'Ramla': 'רמלה',
    };
    return cityMap[cityEnglish] || cityEnglish;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
