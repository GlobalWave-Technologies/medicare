# Staff release guide

Release candidate: Step 14, acceptance completed 4 November 2026; updated for admissions and discharge (Phase 19A). Use this guide with local training and the signed acceptance checklist.

## Signing in and roles

Sign in with your assigned account; there is no role chooser. Administrators and Records Officers register patients, manage patient details, admit patients and change rooms. Medical Officers register and admit patients, change rooms, write clinical records and medication orders, and are the only staff who can discharge. An Administrator account does not grant clinical-record access. Roles are shown as Administrator, Records Officer and Medical Officer everywhere. Administrators manage staff accounts in **Staff & Access**; ask one of them for a new account, a role change, a new password if you forget yours, or to sign you out after a lost device.

**Your first sign-in:** the password an administrator gives you is temporary. When you sign in with
it, Medicare shows **Change your temporary password** before anything else:

1. Enter the temporary password as your current password.
2. Choose your own password and type it twice.
3. Select **Change password**.

You are then signed out and sign in again with your new password. The same happens after an
administrator resets your password. There is no way to skip this step; **Sign out** is the only
other choice.

**If you forget your password,** select **Forgot your password?** on the sign-in page and contact
your system administrator. They reset it and give you a new temporary password through the
hospital's approved channel.

**Install Medicare (optional):** after your first sign-in with your own password, Medicare offers
to add itself to the device so it opens in its own window.

- Choose **Install Medicare** or **Not now**. Either way you go straight to your work.
- You can install later from **Install Medicare** in the menu, where your browser supports it.
- On iPhone or iPad, use **Share** › **Add to Home Screen** › **Add**.
- Medicare needs a network connection: it keeps no records on the device, and shows "Medicare
  needs a network connection to access hospital records." when it is offline.
- When an update is available, a small notice offers **Refresh when safe**. Save or close any open
  form first.

To change your own password, select **Change password** at the bottom of the menu. Enter your current password and the new one twice (15 to 128 characters; spaces are allowed). You are then signed out on every device and sign in again with the new password. Never share your password; support staff will never ask for it.

Repeated failed sign-in attempts are temporarily limited (10 failures in 15 minutes). Workstations that share one network address share this limit, so check your email and password carefully. If you see "Too many sign-in attempts", wait for the time shown and tell support if it keeps happening.

The menu lists only the workspaces your role can use. Medical Officers see Overview, Patients, Medical Records and Notifications. Records Officers see Overview, Patients, Notifications and Reports. Administrators see Overview, Patients, Staff & Access, Notifications and Reports. Choosing a workspace from the menu always returns to its main list. Your name and role are shown at the bottom of the menu. Under **Theme**, just above your name, choose **Light**, **Dark** or **System** (follows your device's setting). The same choice is on the sign-in screen. It applies at once and is remembered on this device only; it is a display setting and stores nothing about you.

Everyone starts on **Overview**, which shows the figures for their own role. **Reports** (administrators and Records Officers) shows activity over a chosen period. Report exports, printing and downloads are not available in this release; do not promise them to staff or customers.

## Patients

Search for an existing patient before registering another (you can type the full name, part of it, or part of the patient number): a patient keeps one record for life, and each hospital stay is added to it. Check the patient number, name and date of birth before admitting or entering clinical information. Registration asks for names and date of birth; phone numbers are no longer collected. The duplicate warning needs a phone number, so it rarely appears now: searching first is what prevents duplicates. Never alter identifying details just to bypass a duplicate warning. Report suspected duplicate patients to the records office.

**Patients** has three views: **All patients**, **Currently admitted** and **Discharged**. Use **Register patient** to add someone (the record only), or **Register & admit** to save the record and go straight on to the room. If a name is missing, the field is marked and the cursor moves to it.

Lists show the first part of each patient number (for example PT-5FD1FD28…); hover over it to see the whole number, and search accepts any part of it. The patient record shows the full number with a **Copy patient number** button. Dates of birth are written out in full (for example 8 September 1968) so they cannot be misread.

Patient removal means **archive**, with **reactivate** available later. Archiving preserves records. A patient who is currently admitted cannot be archived; discharge them first. Use the archived filter to find an archived patient. Check the confirmation before changing status.

Editing a patient saves only the fields you changed. If another person changes the same field at the same time, the later save wins; there is no warning. Use **Refresh patient** before editing a record someone else may be working on.

## Admissions and discharge

Appointments are no longer used. Care is recorded per hospital stay (an **admission**).

- **Admit:** open the patient and select **Admit patient** (or use **Register & admit**). Enter the room, for example "Room 4" or "Ward A – Bed 6". The admission time is now unless you change it; times use the browser's local time zone, which is shown on screen. Each stay gets an admission number such as AD-000123.
- **Already admitted:** a patient can have only one current admission. If you see "This patient is already admitted.", select **Open current admission** instead of admitting again.
- **Change room:** on the patient record select **Change room**, enter the new room and, if useful, a short transfer note. Earlier rooms stay in the room history.
- **Discharge (Medical Officers):** select **Discharge patient**. The dialog shows the patient, the admission number and the room, and reads "Discharging this patient will close the current admission and remove them from Currently admitted. Their admission, room history, clinical records and medications stay in their history." Add a discharge note if needed and select **Discharge patient** in the dialog. If you see "This admission has an unfinished clinical record. Finalize or complete the draft record before discharging the patient.", open the medical record, finish and finalize the draft, then discharge again; nothing is lost.
- Discharge never deletes or archives anything. The stay appears under **Previous admissions** on the patient record, where **View record** shows its rooms and staff (and, for Medical Officers, the discharge note and clinical records). If the patient returns, admit them again: this creates a new stay on the same patient record.
- A discharge cannot be undone. If a patient was discharged by mistake, admit them again and record what happened.

## Clinical records (Medical Officers)

**Medical Records** lists the patients currently admitted. Open a patient's medical record and select **New clinical record**; new records can only be written during an admission, and they start in the patient's current room. Save a draft, refresh and reopen it to verify important entries. Complaints, diagnoses and medications are kept in the order you enter them, so list the principal diagnosis first. Check patient identity again before finalizing.

Record each medicine in the record's **Medications** section: select **Add medication**, type part of the name and choose it from the list (typing alone does not choose it), then enter the **Strength** (for example 500 mg, optional), **Dose** (for example 1 tablet), **Route**, **Frequency** (choose **Other** to type one that is not listed), **Duration** (optional) and **Instructions** (optional), and select **Add to record**. Each medicine appears as a card with **Edit** and **Remove**. If the same medicine is added twice you are warned; keep both only for separate dosing plans. If a medicine is missing from the list, ask an administrator to add it; meanwhile note it in the treatment plan. Medications can be changed while the record is a draft and become permanent when it is finalized. The medical record lists every medication ordered during the admission, and each patient has a full medication history.

The form explains the two steps: **Save draft** keeps the record as a draft you can still change; **Finalize record** (from the saved record, when it is complete) makes it part of the permanent medical record. **Cancel** and **Save draft** stay at the bottom of the form while you scroll.

**Finalize** makes the original record permanent and read-only. Corrections are separate, permanent **amendments** with a reason. Review amendment text before submitting. Amendments cannot be edited or removed, and an amendment identical to one already on the record is refused.

Avoid editing the same draft in two places. Fields you change replace the saved values; fields you did not change are left alone. If a draft was finalized elsewhere, the editor tells you so and your edit is not applied; refresh and use an amendment instead.

## Sessions, interruptions and uncertain saves

Sessions last up to eight hours and can be revoked by an administrator. When a session ends, the next action returns you to sign-in, which says "Your session has ended. Sign in again to continue.", and removes protected content from the screen. On a phone, **Sign out** is at the top of the screen and at the bottom of the menu. **Unsaved text is held only in memory and is lost**: it is never saved to the browser, for privacy. Save drafts regularly. Do not put clinical content in browser notes, personal files or support tickets to work around this.

Unsaved-change warnings help with navigation and closing forms; they do not protect against a browser crash, session expiry or power loss. Stay with the application while a save is pending; buttons are disabled until it finishes. Do not repeatedly activate a save button.

If a request fails, read the message:

- "Your security token needs refreshing": nothing was saved. Submit again deliberately.
- "The registration could not be confirmed", "The admission could not be confirmed", "The draft could not be confirmed" or "The broadcast could not be confirmed": select the same button again **without changing anything**. The patient, admission, draft or broadcast will not be created twice.
- "The room change could not be confirmed" or "The discharge could not be confirmed": close the dialog and refresh the patient record to check the current room or status before trying again. A patient cannot be discharged twice.
- "The amendment could not be confirmed": select **Add permanent amendment** again without changing anything. An identical amendment is never added twice.
- "Finalization could not be confirmed": refresh the clinical record to check its status. A record cannot be finalized twice.
- Any other "could not be confirmed" message (patient changes, patient status, draft edits, staff changes): the save may already have happened. **Check before retrying.** Refresh the patient record, the clinical record or the staff account.
- "This exact amendment is already part of the permanent record": a previous submission succeeded. Refresh to review it.
- "This patient is already admitted." straight after an interrupted save may mean your admission was already saved. Select **Open current admission** to check.

The application never resubmits a save for you. While the form is still open, selecting the save button again without changing anything is safe: if the first attempt was saved, you get that record back instead of a second copy. Once you close the form, a new attempt is a new request, so check first. If you still suspect a patient, an admission, a draft or a broadcast was created twice, tell the records office or support rather than creating more records. Log out on shared workstations, and re-authenticate only with your own account.

## Notifications

**Notifications** shows only the notices delivered to your own account. The number beside it in the navigation is your unread count from the server; it updates when you sign in, move between screens, select **Refresh** or read a notice. It does not update on its own while you stay on one screen, so select **Refresh** to check for new notices. If the count cannot be loaded, no number is shown and the Notifications page offers **Retry unread count**.

Opening a notice marks it as read. **Mark all as read** marks every unread notice in your inbox as read without removing anything. Read notices stay in the list; use the All, Unread and Read filters to find them. Admissions, room changes and discharges do not send notices. Older notices about appointments are marked **Past appointment**; appointments are no longer used, so there is nothing to open from them.

Administrators can send a **New broadcast** to all active staff or to one role. Broadcasts are plain text and cannot be edited or withdrawn once sent. Never include patient names, clinical details, passwords or other confidential information. The confirmation shows how many active staff received it. If the result "could not be confirmed", the broadcast may already have been delivered. Selecting **Send broadcast** again without changing the text will not send it twice. If you close the composer first, check your own inbox (if you were in the audience) or ask a recipient before sending it again.

## Overview and Reports

**Overview** starts with four cards for today: **Currently admitted**, **Admissions today**, **Discharges today**, and **Total patients** (administrators and Records Officers) or **My unfinished records** (Medical Officers: your drafts, which must be finalized before discharge). Below is the **Admissions and discharges** chart for the whole hospital: choose **Last 7 days**, **Last 30 days** or **This month**. The solid line with dots is admissions and the dashed line with squares is discharges; point at a day, or select the chart and use the arrow keys, to see that day's numbers, or select **Show data table**. Then come the most recent admissions (and, for administrators and Records Officers, discharges). The figures update by themselves every minute while the Overview is open; select **Refresh** for them at once. **Register patient** at the top opens registration straight away. Days are UTC calendar days, as in Reports.

**Reports** lets administrators and Records Officers review **Patient registrations** and **Admissions and discharges**. Choose a reporting period and how to group it (day, week or month), then select **Apply**. Reporting dates are UTC calendar dates: around midnight, "today" may differ from your local date. Weeks start on Monday, and the first and last week or month can be partial. Admissions are counted by admission time and discharges by discharge time, so one stay can appear in two periods. A period with no activity is a valid result, not an error. Reports never include clinical notes, diagnoses, rooms or patient names.

## Staff Activity (administrators)

**Staff Activity** shows who is signed in now and recent actions, for running the system (for example finding a computer left signed in, or following up a problem). Each signed-in person shows **Active now** (used the system in the last 5 minutes), **Recently active** (in the last 30 minutes) or **Idle** (signed in, but not used for longer). Being signed in does not mean someone is at the screen, and pages that refresh themselves do not count as use. **Recent staff activity** lists actions such as "Registered a patient" or "Finalized a clinical record"; it never shows clinical details or which patient was involved. Search by name or staff number, filter by role, period and kind of activity. **View activity** shows one person's sessions; **End session** signs out one browser or device and **Sign out everywhere** signs them out on all of them, both after confirmation. Staff & Access also shows each person's **Last active** time, or **Never signed in**.

## Staff & Access (administrators)

Only administrators see **Staff & Access**. It lists every staff account with its role and status, and the totals at the top count all accounts, not just the page shown. Filter by role or status; there is no name search.

**Add staff member** creates an account that can sign in straight away. Enter the institution staff number (STF- followed by 6 to 32 letters or digits) and a work email that no other account uses. Neither these nor the name can be changed later on this screen, so check them before creating the account. Choose the role deliberately. Set an initial password of 15 to 128 characters and give it to the person only through the hospital's approved secure channel, never by ordinary email, chat or ticket; it is not shown again. If creation "could not be confirmed", select **Create account** again without changing anything: the account will not be created twice. A message that the email is already in use after you changed the form may mean the first attempt worked; check the directory.

Select **Manage** to open an account. Every change asks for confirmation and takes effect only when the server confirms it:

- **Change role** changes what the person can open and signs them out everywhere; they sign in again with the new role.
- **Suspend account** signs the person out and blocks sign-in until you select **Reactivate account**. Use it for leave or while access is reviewed.
- **Disable account** is permanent under the current policy and cannot be reversed; the account stays on record. Use it only when the person must never regain access with this account. You must tick a confirmation first.
- **Sign out all sessions** signs the person out on every device without changing their status, for example after a lost device or an unattended shared computer.
- **Reset password** gives someone who forgot their password, or whose password may be known to others, a new one, and signs them out everywhere. **Set password** gives a pending account its first password; activate the account separately. Hand the password over only through the hospital's approved secure channel. It is never shown again, and you cannot reset your own password here: use **Change password** in the menu. Every password you type for someone (when adding them, resetting, or setting a first password) is temporary: they must replace it with their own the next time they sign in. Verify the person's identity with the hospital's procedure before resetting.

At least one active administrator must always remain; the system refuses any change that would leave none. Changing, suspending or signing out your own account signs you out immediately, so keep a second active administrator who can restore access. There is no emailed reset link: a forgotten password is replaced by an administrator. Agree how staff reach an administrator out of hours.

## Getting help

Provide the screen or action, approximate time, browser and the support reference shown with the error. Exclude passwords, cookies, security tokens and patient or clinical text from ordinary support messages. Use the hospital's approved secure process when a support investigation needs patient-specific information.

Before rollout, complete a supervised practice with synthetic data: search, register and admit, a room change, a clinical record with a medication, a discharge refused because of a draft, finalize and discharge, re-admission, amend, session expiry, and checking a record after an uncertain save. Practise opening Overview and a report for each role and comparing **Currently admitted** with the Patients list. Administrators should also practise adding a test account, changing its role, suspending and reactivating it, signing out its sessions and disabling it. Confirm the support contact and downtime procedure locally.
