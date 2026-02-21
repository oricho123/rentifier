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

    if (listing.city) {
      const location = listing.neighborhood
        ? `${listing.city} - ${listing.neighborhood}`
        : listing.city;
      parts.push(`📍 ${this.escapeHtml(location)}`);
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

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
