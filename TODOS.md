# CURRENT TODO

This system is a Blockchain based SSI system between patient, government, hospital, and a pharmacy. The wofkflow is like this: 

1. Patient creates a wallet in aries bifold wallet app
2. Governtment creates a qr code to connect with the patient
3. Patient scans the qr code and connects with the government
4. Government creates a credential and sends it to the patient
5. Patient accepts the credential and stores in the wallet
6. Hospital works as a verifier connects to the patient same as govt. by creating a qr code and sends a identity verification request to the patient. patient accepts the request and sends the credential to the hospital
7. When the patient is verified, doctor can give prescription, reports, or any other documents to the patient.
8. First, the documents will be store on mongodb as a signed document. and then sends the metadata to the patient as credential so that patient can store it in the wallet.
9. Now, when a patient goes to pharmacy. pharmacy creates a qr code to connect with the patient.
10. Patient scans the qr code and connects with the pharmacy.
11. pharmacy creates a document request (like proof request of credential) and sends it to the patient.
12. Patient accepts the request and sends the credential to the pharmacy.
13. Pharmace gets the credential which is basically metadata of the document.
14. pharmacy gets the document from the mongodb and give drugs to the patient.

This is the basic workflow of this app.