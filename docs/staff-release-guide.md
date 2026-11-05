# Staff release guide

Release candidate: Step 14, acceptance completed 4 November 2026. Use this guide with local training and the signed acceptance checklist.

## Signing in and roles

Sign in with your assigned account; there is no role chooser. Admins and Records Officers manage patient demographics and appointments. Doctors see their own appointments and use the clinical-record workflow. An Admin account does not grant clinical-record access. Administrators manage staff accounts in **Staff & Access**; ask one of them for a new account, a role change, a new password if you forget yours, or to sign you out after a lost device.

To change your own password, select **Change password** at the bottom of the menu. Enter your current password and the new one twice (15 to 128 characters; spaces are allowed). You are then signed out on every device and sign in again with the new password. Never share your password; support staff will never ask for it.

Repeated failed sign-in attempts are temporarily limited (10 failures in 15 minutes). Workstations that share one network address share this limit, so check your email and password carefully. If you see "Too many sign-in attempts", wait for the time shown and tell support if it keeps happening.

The menu lists only the workspaces your role can use: Overview, Patients, Appointments, Medical Records (doctors), Staff & Access (administrators), Reports and Notifications. Choosing a workspace from the menu always returns to its main list. Your name and role are shown at the bottom of the menu. Under **Theme**, just above your name, choose **Light**, **Dark** or **System** (follows your device's setting). The same choice is on the sign-in screen. It applies at once and is remembered on this device only; it is a display setting and stores nothing about you.

Everyone starts on **Overview**, which shows the figures for their own role. **Reports** shows activity over a chosen period. Report exports, printing and downloads are not available in this release; do not promise them to staff or customers.

## Patients

Search for an existing patient before registering another. Check the patient number, name and date of birth before booking or entering clinical information. The duplicate warning only appears when both date of birth and phone match an existing patient, so record both whenever they are known. Never alter identifying details just to bypass a duplicate warning. Report suspected duplicate patients to the records office.

Patient removal means **archive**, with **reactivate** available later. Archiving preserves records. Use the archived filter to find an archived patient. Check the confirmation before changing status.

Editing a patient saves only the fields you changed. If another person changes the same field at the same time, the later save wins; there is no warning. Use **Refresh patient** before editing a record someone else may be working on.

## Appointments

Appointment times use the browser's local time zone, which is shown on screen. Confirm the workstation time zone during setup and verify dates and times before saving. A scheduling conflict requires choosing another slot. Check-in opens 60 minutes before the start time; no-show is available from the start time.

Cancellation preserves the appointment and its cancellation reason. It does not erase history; cancelled appointments stay visible under the Cancelled filter. Doctors cannot book, administratively reschedule or cancel appointments.

If an action is refused because the appointment changed (for example, someone else already confirmed or cancelled it), select **Refresh appointment** and decide again from the current status.

## Clinical records

For an eligible appointment, check in and start the linked encounter. Save a draft, refresh and reopen it to verify important entries. Complaints and diagnoses are kept in the order you enter them, so list the principal diagnosis first. Check patient identity again before finalizing.

**Finalize** makes the original record permanent and read-only. Corrections are separate, permanent **amendments** with a reason. Review amendment text before submitting. Amendments cannot be edited or removed, and an amendment identical to one already on the record is refused.

Avoid editing the same draft in two places. Fields you change replace the saved values; fields you did not change are left alone. If a draft was finalized elsewhere, the editor tells you so and your edit is not applied; refresh and use an amendment instead.

## Sessions, interruptions and uncertain saves

Sessions last up to eight hours and can be revoked by an administrator. When a session ends, the next action returns you to sign-in and removes protected content from the screen. **Unsaved text is held only in memory and is lost**: it is never saved to the browser, for privacy. Save drafts regularly. Do not put clinical content in browser notes, personal files or support tickets to work around this.

Unsaved-change warnings help with navigation and closing forms; they do not protect against a browser crash, session expiry or power loss. Stay with the application while a save is pending; buttons are disabled until it finishes. Do not repeatedly activate a save button.

If a request fails, read the message:

- "Your security token needs refreshing": nothing was saved. Submit again deliberately.
- "The registration could not be confirmed", "The draft could not be confirmed" or "The broadcast could not be confirmed": select the same button again **without changing anything**. The patient, draft or broadcast will not be created twice.
- "The amendment could not be confirmed": select **Add permanent amendment** again without changing anything. An identical amendment is never added twice.
- "Finalization could not be confirmed": refresh the clinical record to check its status. A record cannot be finalized twice.
- Any other "could not be confirmed" message (patient changes, patient status, draft edits, appointments, staff changes): the save may already have happened. **Check before retrying.** Refresh the patient record, the schedule, the clinical record or the staff account.
- "This exact amendment is already part of the permanent record": a previous submission succeeded. Refresh to review it.
- A booking conflict straight after an interrupted save may mean your booking was already saved. Refresh the schedule first.

The application never resubmits a save for you. While the form is still open, selecting the save button again without changing anything is safe: if the first attempt was saved, you get that record back instead of a second copy. Once you close the form, a new attempt is a new request, so check first. If you still suspect a patient, a walk-in draft or a broadcast was created twice, tell the records office or support rather than creating more records. Log out on shared workstations, and re-authenticate only with your own account.

## Notifications

**Notifications** shows only the notices delivered to your own account. The number beside it in the navigation is your unread count from the server; it updates when you sign in, move between screens, select **Refresh** or read a notice. It does not update on its own while you stay on one screen, so select **Refresh** to check for new notices. If the count cannot be loaded, no number is shown and the Notifications page offers **Retry unread count**.

Opening a notice marks it as read. **Mark all as read** marks every unread notice in your inbox as read without removing anything. Read notices stay in the list; use the All, Unread and Read filters to find them. Doctors receive a notice when an appointment is assigned, rescheduled, reassigned or cancelled. **View appointment** opens that appointment on the normal appointment screen, with the usual access rules: if it has since been reassigned to someone else, you will see "Appointment not found".

Administrators can send a **New broadcast** to all active staff or to one role. Broadcasts are plain text and cannot be edited or withdrawn once sent. Never include patient names, clinical details, passwords or other confidential information. The confirmation shows how many active staff received it. If the result "could not be confirmed", the broadcast may already have been delivered. Selecting **Send broadcast** again without changing the text will not send it twice. If you close the composer first, check your own inbox (if you were in the audience) or ask a recipient before sending it again.

## Overview and Reports

**Overview** has two parts. **Current status** (for doctors, **My current workload**) is a live count when the page was refreshed, such as active patients or upcoming appointments; it does not change when you pick a period. **Hospital activity** (for doctors, **My activity**) covers Today, the Last 7 days or the Last 30 days. Administrators and Records Officers see hospital-wide registration and appointment figures; doctors see only appointments assigned to them and their own clinical work. The figures do not update by themselves: select **Refresh**, or return to Overview, for current numbers. The time shown is when the figures were produced.

**Reports** lets administrators and Records Officers review patient and appointment activity, and lets doctors review their own clinical activity. Choose a reporting period and how to group it (day, week or month), then select **Apply**. Reporting dates are UTC calendar dates: around midnight, "today" may differ from your local date. Weeks start on Monday, and the first and last week or month can be partial. Appointments are counted by their scheduled date and current status, so a later cancellation or completion changes earlier reports. A period with no activity is a valid result, not an error. Each time a doctor opens their clinical activity report, the view is recorded in the audit log. Reports never include clinical notes, diagnoses or patient names.

## Staff & Access (administrators)

Only administrators see **Staff & Access**. It lists every staff account with its role and status, and the totals at the top count all accounts, not just the page shown. Filter by role or status; there is no name search.

**Add staff member** creates an account that can sign in straight away. Enter the institution staff number (STF- followed by 6 to 32 letters or digits) and a work email that no other account uses. Neither these nor the name can be changed later on this screen, so check them before creating the account. Choose the role deliberately. Set an initial password of 15 to 128 characters and give it to the person only through the hospital's approved secure channel, never by ordinary email, chat or ticket; it is not shown again. If creation "could not be confirmed", select **Create account** again without changing anything: the account will not be created twice. A message that the email is already in use after you changed the form may mean the first attempt worked; check the directory.

Select **Manage** to open an account. Every change asks for confirmation and takes effect only when the server confirms it:

- **Change role** changes what the person can open and signs them out everywhere; they sign in again with the new role.
- **Suspend account** signs the person out and blocks sign-in until you select **Reactivate account**. Use it for leave or while access is reviewed.
- **Disable account** is permanent under the current policy and cannot be reversed; the account stays on record. Use it only when the person must never regain access with this account. You must tick a confirmation first.
- **Sign out all sessions** signs the person out on every device without changing their status, for example after a lost device or an unattended shared computer.
- **Reset password** gives someone who forgot their password, or whose password may be known to others, a new one, and signs them out everywhere. **Set password** gives a pending account its first password; activate the account separately. Hand the password over only through the hospital's approved secure channel. It is never shown again, and you cannot reset your own password here: use **Change password** in the menu.

At least one active administrator must always remain; the system refuses any change that would leave none. Changing, suspending or signing out your own account signs you out immediately, so keep a second active administrator who can restore access. There is no emailed reset link: a forgotten password is replaced by an administrator. Agree how staff reach an administrator out of hours.

## Getting help

Provide the screen or action, approximate time, browser and the support reference shown with the error. Exclude passwords, cookies, security tokens and patient or clinical text from ordinary support messages. Use the hospital's approved secure process when a support investigation needs patient-specific information.

Before rollout, complete a supervised practice with synthetic data: register and search, booking with a conflict and a cancellation, draft, finalize and amend, session expiry, and checking a record after an uncertain save. Practise opening Overview and a report for each role and comparing a figure with the patient directory or schedule. Administrators should also practise adding a test account, changing its role, suspending and reactivating it, signing out its sessions and disabling it. Confirm the support contact and downtime procedure locally.
