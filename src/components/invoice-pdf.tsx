'use client';
import React from 'react';
import { Page, Text, View, Document, StyleSheet, Font, Image } from '@react-pdf/renderer';
import type { Invoice, Client, Company } from '@/lib/types';

// Register Inter font
Font.register({
  family: 'Inter',
  fonts: [
    { src: 'https://fonts.gstatic.com/s/inter/v12/UcC73FwrK3iLTeHuS_fvQtMwCp50KnMa.ttf', fontWeight: 400 },
    { src: 'https://fonts.gstatic.com/s/inter/v12/UcC73FwrK3iLTeHuS_fvQtMwCp50KnMa.ttf', fontWeight: 500 },
    { src: 'https://fonts.gstatic.com/s/inter/v12/UcC73FwrK3iLTeHuS_fvQtMwCp50KnMa.ttf', fontWeight: 600 },
    { src: 'https://fonts.gstatic.com/s/inter/v12/UcC73FwrK3iLTeHuS_fvQtMwCp50KnMa.ttf', fontWeight: 700 },
  ],
});

// Create styles
const styles = StyleSheet.create({
  page: {
    fontFamily: 'Inter',
    fontSize: 10,
    padding: 40,
    backgroundColor: '#fff',
    color: '#1a202c',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 30,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  companyDetails: {
    flex: 1,
  },
  companyName: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  companyAddress: {
    marginTop: 4,
    color: '#4a5568',
  },
  logo: {
      width: 80,
      height: 'auto',
      marginBottom: 8,
  },
  invoiceTitleSection: {
    flex: 1,
    textAlign: 'right',
  },
  invoiceTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#64B5F6',
  },
  invoiceNumber: {
    marginTop: 4,
    color: '#4a5568',
  },
  metaSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 30,
  },
  billTo: {
    flex: 1,
  },
  metaInfo: {
    flex: 1,
    textAlign: 'right',
  },
  sectionTitle: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#4a5568',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  textBold: {
    fontWeight: 'bold',
  },
  table: {
    width: '100%',
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    alignItems: 'center',
  },
  tableHeader: {
    backgroundColor: '#f7fafc',
    fontWeight: 'bold',
  },
  colDescription: {
    width: '55%',
    padding: 8,
  },
  colQty: {
    width: '15%',
    padding: 8,
    textAlign: 'right',
  },
  colPrice: {
    width: '15%',
    padding: 8,
    textAlign: 'right',
  },
  colTotal: {
    width: '15%',
    padding: 8,
    textAlign: 'right',
  },
  footer: {
    marginTop: 20,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  totals: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  totalsContainer: {
    width: '40%',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  totalLabel: {
    textAlign: 'right',
  },
  totalValue: {
    fontWeight: 'bold',
    textAlign: 'right',
  },
  grandTotal: {
    marginTop: 4,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#4a5568',
  },
  grandTotalLabel: {
    fontWeight: 'bold',
    color: '#64B5F6',
  },
  terms: {
      marginTop: 30,
  }
});

interface InvoicePDFProps {
  invoice: Invoice;
  client: Client;
  company: Company;
}

export const InvoicePDF: React.FC<InvoicePDFProps> = ({ invoice, client, company }) => (
  <Document>
    <Page size="A4" style={styles.page}>
      <View style={styles.header}>
        <View style={styles.companyDetails}>
          {company.logoUrl && <Image src={company.logoUrl} style={styles.logo} />}
          <Text style={styles.companyName}>{company.name}</Text>
          <Text style={styles.companyAddress}>{company.address}</Text>
          <Text style={styles.companyAddress}>{company.postalCode} {company.city}</Text>
        </View>
        <View style={styles.invoiceTitleSection}>
          <Text style={styles.invoiceTitle}>FACTURE</Text>
          <Text style={styles.invoiceNumber}>{invoice.invoiceNumber}</Text>
        </View>
      </View>

      <View style={styles.metaSection}>
        <View style={styles.billTo}>
            <Text style={styles.sectionTitle}>Facturé à</Text>
            <Text style={styles.textBold}>{client.name}</Text>
            <Text>{client.address}</Text>
            <Text>{client.postalCode} {client.city}</Text>
        </View>
        <View style={styles.metaInfo}>
            <Text><Text style={styles.textBold}>Date de facturation :</Text> {new Date(invoice.date).toLocaleDateString()}</Text>
            <Text><Text style={styles.textBold}>Date d'échéance :</Text> {new Date(invoice.dueDate).toLocaleDateString()}</Text>
        </View>
      </View>

      <View style={styles.table}>
        <View style={[styles.tableRow, styles.tableHeader]}>
          <Text style={styles.colDescription}>Description</Text>
          <Text style={styles.colQty}>Qté</Text>
          <Text style={styles.colPrice}>P.U.</Text>
          <Text style={styles.colTotal}>Total</Text>
        </View>
        {invoice.lineItems.map((item, index) => (
          <View style={styles.tableRow} key={index}>
            <Text style={styles.colDescription}>{item.description}</Text>
            <Text style={styles.colQty}>{item.quantity}</Text>
            <Text style={styles.colPrice}>{item.unitPrice.toFixed(2)} €</Text>
            <Text style={styles.colTotal}>{item.total.toFixed(2)} €</Text>
          </View>
        ))}
      </View>
      
      <View style={styles.footer}>
        <View style={styles.totals}>
            <View style={styles.totalsContainer}>
                 <View style={styles.totalRow}>
                    <Text style={styles.totalLabel}>Sous-total</Text>
                    <Text style={styles.totalValue}>{invoice.subtotal.toFixed(2)} €</Text>
                </View>
                <View style={styles.totalRow}>
                    <Text style={styles.totalLabel}>TVA (10%)</Text>
                    <Text style={styles.totalValue}>{invoice.tax.toFixed(2)} €</Text>
                </View>
                <View style={[styles.totalRow, styles.grandTotal]}>
                    <Text style={[styles.totalLabel, styles.grandTotalLabel]}>Total</Text>
                    <Text style={[styles.totalValue, styles.grandTotalLabel]}>{invoice.total.toFixed(2)} €</Text>
                </View>
            </View>
        </View>
        <View style={styles.terms}>
            <Text style={styles.sectionTitle}>Conditions de paiement</Text>
            <Text>Paiement sous 30 jours. Merci de votre confiance !</Text>
        </View>
      </View>
    </Page>
  </Document>
);