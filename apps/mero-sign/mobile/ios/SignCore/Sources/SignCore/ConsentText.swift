/// The consent copy, word for word from the web's `ConsentModal`, so a signer
/// agrees to the same thing on every platform. Android `ConsentText.kt` matches.
public enum ConsentText {
    public static let title = "Consent to electronic signing"
    public static let intro = "Before signing, you must agree to conduct business electronically."
    public static let readLink = "Read the agreement to conduct business electronically"
    public static let checkbox = "I agree to receive records electronically in accordance with this Disclosure."
    public static let action = "Continue to sign"
    public static let disclosureTitle = "Electronic Records Disclosure and Consent"
    public static let lead =
        "Please read this Electronic Records Disclosure and Consent (“Disclosure”) carefully and retain a copy for your records."
    public static let items: [String] = [
        "You have the right to receive a paper copy of any record that we provide to you electronically. If you would like to receive a paper copy of any record, you may request it at any time by contacting us at support@calimero.network. We may charge a reasonable fee for providing paper copies.",
        "You may withdraw your consent to receive records electronically at any time. To withdraw your consent, please notify us in writing at support@calimero.network. There are no fees or penalties for withdrawing your consent. However, withdrawing consent may delay the processing of your transaction or limit your ability to use certain services.",
        "Your consent applies to all records and disclosures related to your transactions with us, including but not limited to contracts, agreements, notices, and other communications.",
        "To withdraw your consent or to update your electronic contact information (such as your email address), please contact us at support@calimero.network. It is your responsibility to provide us with a true, accurate, and complete email address and to maintain and update promptly any changes in this information.",
        "To request a paper copy of a record, contact us at support@calimero.network. Please specify which record(s) you would like to receive. A reasonable fee may apply for each paper copy requested.",
        "To access and retain electronic records, you will need: a device with internet access, a current web browser, a valid email address, software capable of viewing PDFs, and sufficient storage or printing capability.",
        "By checking the box below and clicking “I Agree,” you acknowledge that you have read and understand this Disclosure, confirm that you are able to access and retain electronic records, and consent to receive records electronically.",
    ]
}
