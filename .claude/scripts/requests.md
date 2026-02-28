/create-prompt 

To search the web to collect information on how I can create a tool the azure blob storage as a file system. 
I want to be able to create folders, upload, download, replace, delete and edit files. 
I want to use this tool from an agent to allow the agent to read and write content in the file system.
I want this tool to have a configuration part to allow me to configure the blob storage resource and the blob storage container where the file system will resides. 

I want also to support the concept of enriching the files stored in the storage with metadata. 


/create-prompt 

To use the research output and my answers to prepare a plan to build the tool


/team-workflow
To extend the tool to allow it to replicate 
- a complete github repository to an azure storage folder 
- a complete azure devops repository to an azure storage folder 
Both capabilities must be offered by cli and API interfaces 
Everything must be documented according to the instructions 


/change-workflow 
I want you to change the module that sync GitHub or Azure DevOps repositories with Azure storage to get configuration pairs ( repo to azure storage ) either in json or yaml format similar to this:
<github-sync>
- sync-pair-name 
   - github-repo 
   - github-pat

   - azure-storage-address 
   - container 
   - folder (which can be / )
   - Azure-SAS
</github-sync>
<azure-devops-sync>
- sync-pair-name 
   - azure-devops-repo 
   - azure-devops-pat

   - azure-storage-address 
   - container 
   - folder (which can be / )
   - Azure-SAS
</azure-devops-sync>

